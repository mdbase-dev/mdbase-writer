// Converts materialised Markdown to DOCX in the Pandoc worker, which starts
// on the first call and stays for later exports.
import type { FromPandoc, ToPandoc } from "./pandoc-protocol.js";

let worker: Worker | undefined;
let nextId = 1;
const waiting = new Map<number, (m: FromPandoc) => void>();

export function toDocx(markdown: string, files: ToPandoc["files"]): Promise<FromPandoc> {
  if (!worker) {
    worker = new Worker(new URL("./pandoc-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<FromPandoc>) => {
      waiting.get(event.data.id)?.(event.data);
      waiting.delete(event.data.id);
    };
    worker.onerror = (event) => {
      for (const [id, resolve] of waiting) resolve({ id, error: event.message || "Pandoc stopped." });
      waiting.clear();
      worker?.terminate();
      worker = undefined;
    };
  }
  const id = nextId++;
  const w = worker;
  return new Promise((resolve) => {
    waiting.set(id, resolve);
    const transfer = files.flatMap(([, d]) => (typeof d === "string" ? [] : [d.buffer as ArrayBuffer]));
    w.postMessage({ id, baseUrl: import.meta.env.BASE_URL, markdown, files } satisfies ToPandoc, transfer);
  });
}
