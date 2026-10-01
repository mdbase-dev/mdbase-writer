// Typeset preview. Each page is a placeholder sized from the document's page
// list; only pages near the viewport are drawn (to canvas), so the cost of an
// update stays proportional to what is on screen rather than to the length
// of the manuscript. While the writer types, a new document is drawn only
// once they pause, the page in view first, so drawing never holds up a
// keystroke. A page whose content did not change (the renderer fingerprints
// each) is left as drawn. Clicking a page jumps to the Markdown block it came from.
// Pages fit the pane's width, or are shown at a zoom (1 = the page's printed
// size at 96 CSS pixels per inch).
import { createTypstRenderer, type RenderSession } from "@myriaddreamin/typst.ts/renderer";
import rendererWasm from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url";
import { memo, useEffect, useRef, useState } from "react";

import { markAt } from "../compile/marks.js";
import type { BlockPosition, SourceMark } from "../compile/protocol.js";
import { errorMessage, fetchChecked } from "../async.js";
import { semanticLayer } from "./semantics.js";

type Renderer = ReturnType<typeof createTypstRenderer>;
interface PageBox {
  readonly width: number;
  readonly height: number;
}

let rendererPromise: Promise<Renderer> | undefined;
function renderer(): Promise<Renderer> {
  rendererPromise ??= (async () => {
    const r = createTypstRenderer();
    await r.init({ getModule: () => fetchChecked(rendererWasm) });
    return r;
  })().catch((error: unknown) => { rendererPromise = undefined; throw error; });
  return rendererPromise;
}

/** A render session that lives as long as the preview (runWithSession scopes it to a callback). */
async function openSession(): Promise<{ renderer: Renderer; session: RenderSession; close(): void }> {
  const r = await renderer();
  return new Promise((resolve, reject) => {
    void r.runWithSession(
      (session) =>
        new Promise<void>((close) => {
          resolve({ renderer: r, session, close: () => close() });
        }),
    ).catch(reject);
  });
}

export interface PreviewProps {
  artifact?: Uint8Array;
  problem?: string | undefined;
  /** Compile revision of the artifact; recorded on the element once its visible pages are drawn. */
  revision?: number;
  positions: readonly BlockPosition[];
  /** Bibliography entries and citation notes, which show their sources on a click. */
  marks?: readonly SourceMark[];
  stale: boolean;
  onJump(position: BlockPosition): void;
  /** A click on a bibliography entry or a citation note. */
  onSource?(mark: SourceMark): void;
  /** The block at the editor's cursor: scrolled into view when it is off screen. */
  follow?: BlockPosition | undefined;
  /** "fit" to the pane's width, or a scale of the printed size. */
  zoom: number | "fit";
  /** The page at the top of the view and the scale pages are shown at, as they change. */
  onView?(view: PreviewView): void;
  /** A click above the first block (the title block). */
  onTitleClick?(): void;
}

export interface PreviewView {
  readonly page: number;
  readonly pages: number;
  /** Shown size over printed size. */
  readonly scale: number;
}

/** CSS pixels per typographic point at 100%. */
const PX_PER_PT = 96 / 72;

const NEAR_VIEWPORT = "900px 0px";
/** How long documents must stop arriving (the writer pause) before the newest is drawn. */
const SETTLE_MS = 250;

const yieldToInput = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const NO_MARKS: readonly SourceMark[] = [];
const pageTop = (canvas: HTMLCanvasElement) => (canvas.parentElement?.offsetTop ?? 0) + canvas.offsetTop;

export const Preview = memo(function Preview({ artifact, problem, revision, positions, marks = NO_MARKS, stale, onJump, onSource, follow, zoom, onView, onTitleClick }: PreviewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pagesHost = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<readonly PageBox[]>([]);
  const [renderProblem, setRenderProblem] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [sessionEpoch, setSessionEpoch] = useState(0);
  const pagesRef = useRef<readonly PageBox[]>([]);
  const session = useRef<Awaited<ReturnType<typeof openSession>> | null>(null);
  const version = useRef(0);
  const visible = useRef(new Set<number>());
  const drawn = useRef(new Map<number, number>());
  const drawnWidth = useRef(new Map<number, number>());
  /** The renderer's fingerprint of what each page's bitmap shows. */
  const drawnKey = useRef(new Map<number, string>());
  const drawing = useRef<Promise<void>>(Promise.resolve());
  /** Counts documents as they arrive; a draw in progress stops when a newer one is waiting. */
  const arrived = useRef(0);
  const marker = useRef<HTMLDivElement>(null);
  const latest = useRef({ positions, marks, onJump, onSource, revision, onView, onTitleClick, follow });
  latest.current = { positions, marks, onJump, onSource, revision, onView, onTitleClick, follow };

  /** Marks the cursor's block in the margin of its page, from its top to the next block's. */
  const placeMarker = () => {
    const el = marker.current;
    const at = latest.current.follow;
    const box = at ? pagesRef.current[at.page - 1] : undefined;
    const canvas = at ? pagesHost.current?.querySelector<HTMLCanvasElement>(`canvas[data-page="${at.page - 1}"]`) : null;
    if (!el) return;
    if (!at || !box || !canvas) {
      el.hidden = true;
      return;
    }
    const next = latest.current.positions.find((p) => p.page === at.page && p.y > at.y + 1);
    const scale = canvas.clientHeight / box.height;
    // The last block on a page runs to its bottom margin; a guess keeps the mark short.
    const height = Math.min(next ? next.y - at.y : 36, box.height * 0.4);
    el.hidden = false;
    el.style.top = `${pageTop(canvas) + at.y * scale}px`;
    el.style.height = `${Math.max(10, height * scale)}px`;
    el.style.left = `${(canvas.parentElement?.offsetLeft ?? 0) + canvas.offsetLeft + Math.max(8, 24 * scale)}px`;
  };

  useEffect(() => {
    let live = true;
    setRenderProblem(null);
    void openSession().then((s) => {
      if (live) { session.current = s; setSessionEpoch((epoch) => epoch + 1); }
      else s.close();
    }).catch((error: unknown) => { if (live) setRenderProblem(errorMessage(error)); });
    return () => {
      live = false;
      version.current++;
      const old = session.current;
      session.current = null;
      void drawing.current.finally(() => old?.close());
      drawn.current.clear();
      drawnKey.current.clear();
      drawnWidth.current.clear();
    };
  }, [retry]);

  /** Draws every visible page that is behind the current document version. */
  const drawVisible = () => {
    drawing.current = drawing.current.then(async () => {
      const s = session.current;
      const host = pagesHost.current;
      if (!s || !host) return;
      const v = version.current;
      const waiting = arrived.current;
      // Pages on screen first, then those just above and below it.
      const view = scroller.current?.getBoundingClientRect();
      const onScreen = (c: HTMLCanvasElement | null) => {
        const r = c?.getBoundingClientRect();
        return Boolean(r && view && r.bottom > view.top && r.top < view.bottom);
      };
      const canvases = [...visible.current].map((index) => ({ index, canvas: host.querySelector<HTMLCanvasElement>(`canvas[data-page="${index}"]`) }));
      canvases.sort((a, b) => Number(onScreen(b.canvas)) - Number(onScreen(a.canvas)) || a.index - b.index);
      let first = true;
      for (const { index, canvas } of canvases) {
        const box = pagesRef.current[index];
        if (!canvas || !box) continue;
        const cssWidth = canvas.clientWidth || 600;
        // Drawn for this document at this size (a zoom or a wider pane needs more pixels).
        if (drawn.current.get(index) === v && drawnWidth.current.get(index) === cssWidth) continue;
        // Each page is a long task: let keystrokes in between, and leave the
        // rest for the newer document if one arrived meanwhile.
        if (!first) await yieldToInput();
        first = false;
        if (arrived.current !== waiting || version.current !== v) return;
        const pixelPerPt = Math.min(4, Math.max(1, (cssWidth / box.width) * (window.devicePixelRatio || 1)));
        const next = document.createElement("canvas");
        next.width = Math.round(box.width * pixelPerPt);
        next.height = Math.round(box.height * pixelPerPt);
        const ctx = next.getContext("2d");
        if (!ctx) continue;
        // Given the fingerprint of the bitmap on screen, the renderer draws
        // nothing when the page is unchanged and returns the same one.
        const shown = drawnWidth.current.get(index) === cssWidth ? drawnKey.current.get(index) : undefined;
        const result = await s.renderer.renderCanvas({ renderSession: s.session, canvas: ctx, pageOffset: index, backgroundColor: "#ffffff", pixelPerPt, ...(shown ? { cacheKey: shown } : {}) });
        if (version.current !== v) return; // a newer document arrived; its pass redraws
        const key = result?.cacheKey;
        if (!shown || key !== shown) {
          // Swap in the finished bitmap in one step so a page never flashes blank.
          canvas.width = next.width;
          canvas.height = next.height;
          canvas.getContext("2d")?.drawImage(next, 0, 0);
        }
        const layer = host.querySelector<HTMLElement>(`.text-layer[data-page="${index}"]`);
        if (layer) {
          layer.style.setProperty("--data-text-width", `${cssWidth / box.width}px`);
          layer.style.setProperty("--data-text-height", `${canvas.clientHeight / box.height}px`);
          if ((!shown || key !== shown) && result?.htmlSemantics?.[0]) layer.replaceChildren(semanticLayer(result.htmlSemantics[0]));
        }
        if (key) drawnKey.current.set(index, key);
        else drawnKey.current.delete(index);
        drawn.current.set(index, v);
        drawnWidth.current.set(index, cssWidth);
        canvas.dataset["version"] = String(v);
      }
      const r = latest.current.revision;
      if (r !== undefined && version.current === v) host.dataset["renderedRevision"] = String(r);
    }).catch((error: unknown) => { if (pagesHost.current?.isConnected) setRenderProblem(errorMessage(error)); });
  };

  // A new document: load it into the session and redraw what is visible. The
  // first is drawn at once; later ones once documents stop arriving for a
  // moment. (Drawing each as it comes slows typing, and so the next compile,
  // until drawing is all the page does.)
  useEffect(() => {
    if (!artifact || !session.current) return;
    arrived.current++;
    let cancelled = false;
    const load = async () => {
      const s = session.current;
      if (!s || cancelled) return;
      await drawing.current;
      if (cancelled || s !== session.current) return;
      s.renderer.manipulateData({ renderSession: s.session, action: "reset", data: artifact });
      const info = s.session.retrievePagesInfo().map((p) => ({ width: p.width, height: p.height }));
      version.current++;
      pagesRef.current = info;
      setPages((prev) => (prev.length === info.length && prev.every((p, i) => p.width === info[i]?.width && p.height === info[i]?.height) ? prev : info));
      requestAnimationFrame(drawVisible);
    };
    const safeLoad = () => void load().catch((error: unknown) => { if (!cancelled) setRenderProblem(errorMessage(error)); });
    const timer = pagesRef.current.length === 0 ? undefined : setTimeout(safeLoad, SETTLE_MS);
    if (!timer) safeLoad();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one load per artifact
  }, [artifact, sessionEpoch]);

  // Track which pages are near the viewport; draw pages as they come into view.
  useEffect(() => {
    const root = scroller.current;
    const host = pagesHost.current;
    if (!root || !host) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const index = Number((e.target as HTMLElement).dataset["page"]);
          if (e.isIntersecting) visible.current.add(index);
          else visible.current.delete(index);
        }
        drawVisible();
      },
      { root, rootMargin: NEAR_VIEWPORT },
    );
    host.querySelectorAll("canvas[data-page]").forEach((c) => observer.observe(c));
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-observe when the page list changes
  }, [pages]);

  // Report the page at the top third of the view and the scale pages are shown at.
  const report = useRef(0);
  const reportView = () => {
    cancelAnimationFrame(report.current);
    report.current = requestAnimationFrame(() => {
      const root = scroller.current;
      const canvases = pagesHost.current?.querySelectorAll<HTMLCanvasElement>("canvas[data-page]");
      const first = pagesRef.current[0];
      if (!root || !canvases?.length || !first) return;
      const line = root.scrollTop + root.clientHeight / 3;
      let page = 1;
      canvases.forEach((c, i) => {
        if (pageTop(c) <= line) page = i + 1;
      });
      latest.current.onView?.({ page, pages: canvases.length, scale: (canvases[0] as HTMLCanvasElement).clientWidth / (first.width * PX_PER_PT) });
    });
  };

  // A different zoom or pane size: pages near the view are redrawn at the new size.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      reportView();
      placeMarker();
      clearTimeout(timer);
      timer = setTimeout(drawVisible, 120);
    });
    observer.observe(root);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- drawVisible and reportView read refs only
  }, []);
  useEffect(() => {
    reportView();
    drawVisible();
    placeMarker();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
  }, [zoom, pages]);

  // Editor → preview: bring the cursor's block into view, leaving the scroll
  // alone while it is visible so typing does not make the preview jump.
  useEffect(() => {
    const root = scroller.current;
    const box = follow ? pagesRef.current[follow.page - 1] : undefined;
    const canvas = follow ? pagesHost.current?.querySelector<HTMLCanvasElement>(`canvas[data-page="${follow.page - 1}"]`) : null;
    if (!root || !follow || !box || !canvas) return;
    const top = pageTop(canvas) + (follow.y / box.height) * canvas.clientHeight;
    const margin = root.clientHeight * 0.15;
    if (top >= root.scrollTop + margin && top <= root.scrollTop + root.clientHeight - margin) return;
    root.scrollTo({ top: Math.max(0, top - root.clientHeight / 3), behavior: "smooth" });
  }, [follow, pages]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- placeMarker reads refs only
  useEffect(placeMarker, [follow, pages, positions]);

  /** The page (1-based) and height on it, in pt, of a pointer event over a page. */
  const pointOf = (event: React.MouseEvent): { canvas: HTMLCanvasElement; page: number; y: number } | null => {
    const pageElement = (event.target as HTMLElement).closest<HTMLElement>(".preview-page");
    const canvas = pageElement?.querySelector<HTMLCanvasElement>("canvas[data-page]");
    if (!canvas) return null;
    const index = Number(canvas.dataset["page"]);
    const box = pagesRef.current[index];
    if (!box) return null;
    const rect = canvas.getBoundingClientRect();
    return { canvas, page: index + 1, y: ((event.clientY - rect.top) / rect.height) * box.height };
  };

  // Over a bibliography entry or citation note, the pointer says it can be clicked.
  const onMouseMove = (event: React.MouseEvent) => {
    const at = pointOf(event);
    if (!at) return;
    const over = Boolean(latest.current.onSource && markAt(latest.current.marks, at.page, at.y));
    // Only crossing into or out of a passage changes the page.
    if (at.canvas.classList.contains("over-source") === over) return;
    at.canvas.classList.toggle("over-source", over);
    at.canvas.title = over ? "Show in Sources" : "";
  };

  const onClick = (event: React.MouseEvent) => {
    // Selecting/copying text and following a real link must not steal focus.
    if (window.getSelection()?.toString() || (event.target as HTMLElement).closest("a")) return;
    const at = pointOf(event);
    if (!at) return;
    const { page, y } = at;
    const mark = markAt(latest.current.marks, page, y);
    if (mark && latest.current.onSource) return latest.current.onSource(mark);
    const before = latest.current.positions.filter((p) => p.page < page || (p.page === page && p.y <= y + 2));
    const hit = before[before.length - 1];
    if (hit) latest.current.onJump(hit);
    else if (page === 1) latest.current.onTitleClick?.();
  };

  return (
    <div ref={scroller} className={`preview${stale ? " is-stale" : ""}${zoom === "fit" ? " is-fit" : ""}`} aria-label={`Typeset preview, ${pages.length} ${pages.length === 1 ? "page" : "pages"}`} onScroll={reportView}>
      {renderProblem && <div className="banner" role="alert"><span>Preview rendering failed: {renderProblem}. Your text is still available in the editor.</span><button type="button" className="mdbase-button" onClick={() => setRetry((value) => value + 1)}>Retry rendering</button></div>}
      {!artifact && <p className="preview-empty">{problem ? "Preview unavailable. You can keep writing." : "Typesetting…"}</p>}
      {stale && artifact && <p className="muted small" role="status">Showing the last successful preview; it may not match your latest text.</p>}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer shortcut; Problems and the outline offer the same navigation */}
      <div className="preview-pages" ref={pagesHost} onClick={onClick} onMouseMove={onMouseMove}>
        {pages.map((p, i) => (
          <div key={i} className="preview-page" style={{ aspectRatio: `${p.width} / ${p.height}`, ...(zoom === "fit" ? {} : { width: `${Math.round(p.width * PX_PER_PT * zoom)}px` }) }}>
            <canvas data-page={i} className="page" aria-hidden="true" />
            <div className="text-layer" data-page={i} role="region" aria-label={`Page ${i + 1}`} tabIndex={0} />
          </div>
        ))}
        <div ref={marker} className="preview-cursor" aria-hidden="true" hidden />
      </div>
    </div>
  );
});
