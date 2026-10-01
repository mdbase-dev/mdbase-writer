// Lazy Pandoc worker. Requests settle on crash, timeout and cancellation.
import type { FromPandoc, ToPandoc } from "./pandoc-protocol.js";

let worker: Worker | undefined;
let nextId = 1;
const waiting = new Map<number, (message: FromPandoc) => void>();

function stop(error: string): void {
  worker?.terminate();
  worker = undefined;
  for (const [id, finish] of [...waiting]) finish({ id, error });
}

export function toDocx(markdown: string, files: ToPandoc["files"], signal?: AbortSignal): Promise<FromPandoc> {
  if (signal?.aborted) return Promise.resolve({ id: nextId++, error: "Export cancelled." });
  if (!worker) {
    worker = new Worker(new URL("./pandoc-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<FromPandoc>) => waiting.get(event.data.id)?.(event.data);
    worker.onerror = (event) => { event.preventDefault(); stop(event.message || "Pandoc stopped."); };
    worker.onmessageerror = () => stop("Pandoc returned an unreadable response.");
  }
  const id = nextId++;
  const current = worker;
  return new Promise((resolve) => {
    const abort = () => stop("Export cancelled.");
    const timer = setTimeout(() => stop("Word export timed out. Check your connection and try again."), 120_000);
    const finish = (message: FromPandoc) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      waiting.delete(id);
      resolve(message);
    };
    waiting.set(id, finish);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const transfer = files.flatMap(([, data]) => typeof data === "string" ? [] : [data.buffer as ArrayBuffer]);
      current.postMessage({ id, baseUrl: import.meta.env.BASE_URL, markdown, files } satisfies ToPandoc, transfer);
    } catch (error) { stop(error instanceof Error ? error.message : String(error)); }
  });
}
