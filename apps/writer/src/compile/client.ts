// Typed handle on the compile worker.
import type { CompileResult, FromWorker, ToWorker } from "./protocol.js";

export class CompileClient {
  private readonly worker: Worker;
  private readonly resultListeners = new Set<(result: CompileResult) => void>();
  private readonly failureListeners = new Set<(message: string) => void>();
  private readonly pdfWaiters = new Map<number, (outcome: { bytes?: Uint8Array; error?: string }) => void>();
  private nextPdf = 1;
  readonly ready: Promise<number>;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    let resolveReady: (ms: number) => void = () => {};
    this.ready = new Promise((resolve) => (resolveReady = resolve));
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const m = event.data;
      if (m.type === "ready") resolveReady(m.initMs);
      else if (m.type === "result") for (const l of this.resultListeners) l(m);
      else if (m.type === "pdf") {
        this.pdfWaiters.get(m.id)?.({ ...(m.bytes ? { bytes: m.bytes } : {}), ...(m.error ? { error: m.error } : {}) });
        this.pdfWaiters.delete(m.id);
      } else if (m.type === "failure") for (const l of this.failureListeners) l(m.message);
    };
    this.worker.onerror = (event) => {
      for (const l of this.failureListeners) l(event.message || "The compile worker stopped.");
    };
  }

  send(message: ToWorker, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  onResult(listener: (result: CompileResult) => void): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }

  onFailure(listener: (message: string) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }

  exportPdf(): Promise<{ bytes?: Uint8Array; error?: string }> {
    const id = this.nextPdf++;
    return new Promise((resolve) => {
      this.pdfWaiters.set(id, resolve);
      this.send({ type: "export-pdf", id });
    });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
