/// <reference lib="webworker" />
// Runs Pandoc (the official WebAssembly build) for the Word export. It lives
// in its own worker, started on the first export, so its 58 MB module never
// touches the editing path. Deployed builds fetch the module from
// functions/wasm (R2), like the Typst compiler; development serves it from
// node_modules.
import { createPandocInstance, type PandocInstance } from "pandoc-wasm/core";

import type { FromPandoc, ToPandoc } from "./pandoc-protocol.js";

declare const self: DedicatedWorkerGlobalScope;
declare const __PANDOC_WASM_VERSION__: string;

async function wasmUrl(baseUrl: string): Promise<string> {
  if (import.meta.env.DEV) return (await import("pandoc-wasm/pandoc.wasm?url")).default;
  return `${baseUrl}wasm/pandoc-${__PANDOC_WASM_VERSION__}.wasm`;
}

let pandoc: Promise<PandocInstance> | undefined;
function instance(baseUrl: string): Promise<PandocInstance> {
  pandoc ??= (async () => {
    const response = await fetch(await wasmUrl(baseUrl));
    if (!response.ok) throw new Error(`Pandoc could not be loaded (${response.status}).`);
    return createPandocInstance(await response.arrayBuffer());
  })();
  pandoc.catch(() => (pandoc = undefined));
  return pandoc;
}

self.onmessage = async (event: MessageEvent<ToPandoc>) => {
  const { id, baseUrl, markdown, files } = event.data;
  const post = (m: FromPandoc, transfer: Transferable[] = []) => self.postMessage(m, transfer);
  try {
    const p = await instance(baseUrl);
    const inputs: Record<string, string | Blob> = {};
    for (const [name, data] of files) inputs[name] = typeof data === "string" ? data : new Blob([data as BlobPart]);
    const result = await p.convert(
      {
        from: "markdown",
        to: "docx",
        "output-file": "manuscript.docx",
        standalone: true,
        citeproc: true,
        "reference-doc": "reference.docx",
        "resource-path": ["."],
      },
      markdown,
      inputs,
    );
    const docx = result.files["manuscript.docx"];
    if (!docx) {
      post({ id, error: result.stderr.trim() || "Pandoc produced no document." });
      return;
    }
    const bytes = new Uint8Array(await docx.arrayBuffer());
    const warnings = result.warnings.map((w) => (typeof w === "string" ? w : String((w as { message?: string }).message ?? JSON.stringify(w))));
    post({ id, bytes, warnings }, [bytes.buffer]);
  } catch (e) {
    post({ id, error: e instanceof Error ? e.message : String(e) });
  }
};
