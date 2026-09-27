// Typeset preview: the Typst vector artifact rendered as SVG pages. Clicking
// a page jumps to the Markdown block it came from.
import { createTypstRenderer } from "@myriaddreamin/typst.ts/renderer";
import rendererWasm from "@myriaddreamin/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm?url";
import { useEffect, useRef, useState } from "react";

import type { BlockPosition } from "../compile/protocol.js";

// typst.ts 0.7.0's renderToSvg unwraps window.typstProcessSvg unconditionally.
(window as unknown as { typstProcessSvg?: () => void }).typstProcessSvg ??= () => {};

let rendererPromise: Promise<ReturnType<typeof createTypstRenderer>> | undefined;
function renderer() {
  rendererPromise ??= (async () => {
    const r = createTypstRenderer();
    await r.init({ getModule: () => fetch(rendererWasm) });
    return r;
  })();
  return rendererPromise;
}

export interface PreviewProps {
  artifact?: Uint8Array;
  /** Compile revision of the artifact; recorded on the element once drawn. */
  revision?: number;
  positions: readonly BlockPosition[];
  stale: boolean;
  onJump(position: BlockPosition): void;
  onRendered?(ms: number): void;
}

export function Preview({ artifact, revision, positions, stale, onJump, onRendered }: PreviewProps) {
  const host = useRef<HTMLDivElement>(null);
  const [pages, setPages] = useState(0);
  const latest = useRef({ positions, onJump });
  latest.current = { positions, onJump };

  useEffect(() => {
    const el = host.current;
    if (!el || !artifact) return;
    let cancelled = false;
    const started = performance.now();
    void renderer().then(async (r) => {
      if (cancelled) return;
      // renderToSvg skips work when the container's recorded width is
      // unchanged (`data-applied-width`), which would leave a stale document
      // on screen. Every artifact is a new document, so clear the marker.
      el.removeAttribute("data-applied-width");
      await r.renderToSvg({ artifactContent: artifact, format: "vector", container: el } as Parameters<typeof r.renderToSvg>[0]);
      if (cancelled) return;
      if (revision !== undefined) el.dataset["renderedRevision"] = String(revision);
      setPages(el.querySelectorAll("g.typst-page").length);
      onRendered?.(performance.now() - started);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- render once per artifact
  }, [artifact]);

  const onClick = (event: React.MouseEvent) => {
    const svg = host.current?.querySelector("svg");
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(ctm.inverse());
    const groups = [...svg.querySelectorAll<SVGGElement>("g.typst-page")];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (!g) continue;
      const top = g.transform.baseVal.consolidate()?.matrix.f ?? 0;
      const height = Number.parseFloat(g.getAttribute("data-page-height") ?? "0");
      if (point.y < top || point.y >= top + height) continue;
      const page = i + 1;
      const y = point.y - top;
      const before = latest.current.positions.filter((p) => p.page < page || (p.page === page && p.y <= y + 2));
      const hit = before[before.length - 1];
      if (hit) latest.current.onJump(hit);
      return;
    }
  };

  return (
    <div className={`preview${stale ? " is-stale" : ""}`} aria-label={`Typeset preview, ${pages} ${pages === 1 ? "page" : "pages"}`}>
      {!artifact && <p className="preview-empty">Typesetting…</p>}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- pointer shortcut; the outline offers the same navigation */}
      <div className="preview-pages" ref={host} onClick={onClick} />
    </div>
  );
}
