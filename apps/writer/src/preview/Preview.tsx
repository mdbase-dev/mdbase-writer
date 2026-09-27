// Typeset preview. Each page is a placeholder sized from the document's page
// list; only pages near the viewport are drawn (to canvas), so the cost of an
// update stays proportional to what is on screen rather than to the length
// of the manuscript. Clicking a page jumps to the Markdown block it came from.
import { createTypstRenderer, type RenderSession } from "@myriaddreamin/typst.ts/renderer";
import rendererWasm from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url";
import { useEffect, useRef, useState } from "react";

import type { BlockPosition } from "../compile/protocol.js";

type Renderer = ReturnType<typeof createTypstRenderer>;
interface PageBox {
  readonly width: number;
  readonly height: number;
}

let rendererPromise: Promise<Renderer> | undefined;
function renderer(): Promise<Renderer> {
  rendererPromise ??= (async () => {
    const r = createTypstRenderer();
    await r.init({ getModule: () => fetch(rendererWasm) });
    return r;
  })();
  return rendererPromise;
}

/** A render session that lives as long as the preview (runWithSession scopes it to a callback). */
async function openSession(): Promise<{ renderer: Renderer; session: RenderSession; close(): void }> {
  const r = await renderer();
  return new Promise((resolve) => {
    void r.runWithSession(
      (session) =>
        new Promise<void>((close) => {
          resolve({ renderer: r, session, close: () => close() });
        }),
    );
  });
}

export interface PreviewProps {
  artifact?: Uint8Array;
  /** Compile revision of the artifact; recorded on the element once its visible pages are drawn. */
  revision?: number;
  positions: readonly BlockPosition[];
  stale: boolean;
  onJump(position: BlockPosition): void;
  /** The block at the editor's cursor: scrolled into view when it is off screen. */
  follow?: BlockPosition | undefined;
}

const NEAR_VIEWPORT = "900px 0px";

export function Preview({ artifact, revision, positions, stale, onJump, follow }: PreviewProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const pagesHost = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState<readonly PageBox[]>([]);
  const pagesRef = useRef<readonly PageBox[]>([]);
  const session = useRef<Awaited<ReturnType<typeof openSession>> | null>(null);
  const version = useRef(0);
  const visible = useRef(new Set<number>());
  const drawn = useRef(new Map<number, number>());
  const drawing = useRef<Promise<void>>(Promise.resolve());
  const latest = useRef({ positions, onJump, revision });
  latest.current = { positions, onJump, revision };

  useEffect(() => {
    let live = true;
    void openSession().then((s) => {
      if (live) session.current = s;
      else s.close();
    });
    return () => {
      live = false;
      session.current?.close();
      session.current = null;
    };
  }, []);

  /** Draws every visible page that is behind the current document version. */
  const drawVisible = () => {
    drawing.current = drawing.current.then(async () => {
      const s = session.current;
      const host = pagesHost.current;
      if (!s || !host) return;
      const v = version.current;
      for (const index of [...visible.current].sort((a, b) => a - b)) {
        if (drawn.current.get(index) === v) continue;
        const canvas = host.querySelector<HTMLCanvasElement>(`canvas[data-page="${index}"]`);
        const box = pagesRef.current[index];
        if (!canvas || !box) continue;
        const cssWidth = canvas.clientWidth || 600;
        const pixelPerPt = Math.min(4, Math.max(1, (cssWidth / box.width) * (window.devicePixelRatio || 1)));
        const next = document.createElement("canvas");
        next.width = Math.round(box.width * pixelPerPt);
        next.height = Math.round(box.height * pixelPerPt);
        const ctx = next.getContext("2d");
        if (!ctx) continue;
        await s.renderer.renderCanvas({ renderSession: s.session, canvas: ctx, pageOffset: index, backgroundColor: "#ffffff", pixelPerPt } as Parameters<Renderer["renderCanvas"]>[0]);
        if (version.current !== v) return; // a newer document arrived; its pass redraws
        // Swap in the finished bitmap in one step so a page never flashes blank.
        canvas.width = next.width;
        canvas.height = next.height;
        canvas.getContext("2d")?.drawImage(next, 0, 0);
        drawn.current.set(index, v);
        canvas.dataset["version"] = String(v);
      }
      const r = latest.current.revision;
      if (r !== undefined && version.current === v) host.dataset["renderedRevision"] = String(r);
    });
  };

  // A new document: load it into the session and redraw what is visible.
  useEffect(() => {
    if (!artifact) return;
    let cancelled = false;
    const load = async () => {
      while (!session.current && !cancelled) await new Promise((r) => setTimeout(r, 20));
      const s = session.current;
      if (!s || cancelled) return;
      await drawing.current;
      s.renderer.manipulateData({ renderSession: s.session, action: "reset", data: artifact });
      const info = s.session.retrievePagesInfo().map((p) => ({ width: p.width, height: p.height }));
      version.current++;
      pagesRef.current = info;
      setPages((prev) => (prev.length === info.length && prev.every((p, i) => p.width === info[i]?.width && p.height === info[i]?.height) ? prev : info));
      requestAnimationFrame(drawVisible);
    };
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one load per artifact
  }, [artifact]);

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

  // Editor → preview: bring the cursor's block into view, leaving the scroll
  // alone while it is visible so typing does not make the preview jump.
  useEffect(() => {
    const root = scroller.current;
    const box = follow ? pagesRef.current[follow.page - 1] : undefined;
    const canvas = follow ? pagesHost.current?.querySelector<HTMLCanvasElement>(`canvas[data-page="${follow.page - 1}"]`) : null;
    if (!root || !follow || !box || !canvas) return;
    const top = canvas.offsetTop + (follow.y / box.height) * canvas.clientHeight;
    const margin = root.clientHeight * 0.15;
    if (top >= root.scrollTop + margin && top <= root.scrollTop + root.clientHeight - margin) return;
    root.scrollTo({ top: Math.max(0, top - root.clientHeight / 3), behavior: "smooth" });
  }, [follow, pages]);

  const onClick = (event: React.MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLCanvasElement>("canvas[data-page]");
    if (!target) return;
    const index = Number(target.dataset["page"]);
    const box = pagesRef.current[index];
    if (!box) return;
    const rect = target.getBoundingClientRect();
    const y = ((event.clientY - rect.top) / rect.height) * box.height;
    const page = index + 1;
    const before = latest.current.positions.filter((p) => p.page < page || (p.page === page && p.y <= y + 2));
    const hit = before[before.length - 1];
    if (hit) latest.current.onJump(hit);
  };

  return (
    <div ref={scroller} className={`preview${stale ? " is-stale" : ""}`} aria-label={`Typeset preview, ${pages.length} ${pages.length === 1 ? "page" : "pages"}`}>
      {!artifact && <p className="preview-empty">Typesetting…</p>}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer shortcut; Problems and the outline offer the same navigation */}
      <div className="preview-pages" ref={pagesHost} onClick={onClick}>
        {pages.map((p, i) => (
          <canvas key={i} data-page={i} className="page" style={{ aspectRatio: `${p.width} / ${p.height}` }} aria-label={`Page ${i + 1}`} />
        ))}
      </div>
    </div>
  );
}
