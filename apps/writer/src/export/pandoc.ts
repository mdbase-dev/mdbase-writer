import { t } from "@lingui/core/macro";
// Lazy Pandoc worker. Requests settle on crash, timeout and cancellation.
import type { FromPandoc, ToPandoc } from "./pandoc-protocol.js";
import { pandocWarnings } from "./warnings.js";

type DocxResult =
  | { readonly id: number; readonly bytes: Uint8Array; readonly warnings: readonly string[]; readonly error?: undefined }
  | { readonly id: number; readonly error: string; readonly bytes?: undefined };

let worker: Worker | undefined;
let nextId = 1;
const waiting = new Map<number, (message: DocxResult) => void>();

function stop(error: string): void {
  worker?.terminate();
  worker = undefined;
  for (const [id, finish] of [...waiting]) finish({ id, error });
}

export function toDocx(markdown: string, files: ToPandoc["files"], signal?: AbortSignal): Promise<DocxResult> {
  if (signal?.aborted) return Promise.resolve({ id: nextId++, error: t`Export cancelled.` });
  if (!worker) {
    worker = new Worker(new URL("./pandoc-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<FromPandoc>) => {
      const result = event.data;
      waiting.get(result.id)?.(result.bytes
        ? { ...result, warnings: pandocWarnings(result.warnings) }
        : { id: result.id, error: result.reason === "no-document" ? t`Pandoc produced no document.` : result.error });
    };
    worker.onerror = (event) => { event.preventDefault(); stop(event.message || t`Pandoc stopped.`); };
    worker.onmessageerror = () => stop(t`Pandoc returned an unreadable response.`);
  }
  const id = nextId++;
  const current = worker;
  return new Promise((resolve) => {
    const abort = () => stop(t`Export cancelled.`);
    const timer = setTimeout(() => stop(t`Word export timed out. Check your connection and try again.`), 120_000);
    const finish = (message: DocxResult) => {
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
