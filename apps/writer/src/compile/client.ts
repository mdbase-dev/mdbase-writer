// Typed, bounded handle on the compile worker. Every request settles on failure/disposal.
import type { CompileResult, FromWorker, ToWorker } from "./protocol.js";

type PdfOutcome = { bytes?: Uint8Array; error?: string };
export class CompileClient {
  private readonly worker: Worker;
  private readonly resultListeners = new Set<(result: CompileResult) => void>();
  private readonly failureListeners = new Set<(message: string) => void>();
  private readonly pdfWaiters = new Map<number, (outcome: PdfOutcome) => void>();
  private nextPdf = 1;
  private stopped: string | undefined;
  private rejectReady: (error: Error) => void = () => {};
  private initTimer: ReturnType<typeof setTimeout>;
  private compileTimer: ReturnType<typeof setTimeout> | undefined;
  readonly ready: Promise<number>;

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    let resolveReady: (ms: number) => void = () => {};
    this.ready = new Promise((resolve, reject) => { resolveReady = resolve; this.rejectReady = reject; });
    // The workspace listens for failures; consumers may additionally await readiness.
    void this.ready.catch(() => {});
    this.initTimer = setTimeout(() => this.fail("The preview took too long to load. Retry the preview."), 60_000);
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const m = event.data;
      if (m.type === "ready") { clearTimeout(this.initTimer); resolveReady(m.initMs); }
      else if (m.type === "result") {
        clearTimeout(this.compileTimer);
        this.compileTimer = undefined;
        for (const l of this.resultListeners) l(m);
      }
      else if (m.type === "pdf") this.pdfWaiters.get(m.id)?.(m);
      else if (m.type === "failure") this.fail(m.message);
    };
    this.worker.onerror = (event) => { event.preventDefault(); this.fail(event.message || "The compile worker stopped."); };
    this.worker.onmessageerror = () => this.fail("The preview worker returned an unreadable response.");
  }
  private fail(message: string): void {
    if (this.stopped) return;
    this.stopped = message;
    clearTimeout(this.initTimer);
    clearTimeout(this.compileTimer);
    this.worker.terminate();
    this.rejectReady(new Error(message));
    for (const resolve of [...this.pdfWaiters.values()]) resolve({ error: message });
    for (const listener of this.failureListeners) listener(message);
  }
  send(message: ToWorker, transfer: Transferable[] = []): void {
    if (this.stopped) return;
    if (message.type !== "prepare" && message.type !== "init" && message.type !== "export-pdf" && this.compileTimer === undefined) {
      this.compileTimer = setTimeout(() => this.fail("Typesetting took too long. Your editor is still available; retry the preview."), 60_000);
    }
    try { this.worker.postMessage(message, transfer); }
    catch (error) { this.fail(error instanceof Error ? error.message : String(error)); }
  }
  onResult(listener: (result: CompileResult) => void): () => void {
    this.resultListeners.add(listener);
    return () => this.resultListeners.delete(listener);
  }
  onFailure(listener: (message: string) => void): () => void {
    this.failureListeners.add(listener);
    return () => this.failureListeners.delete(listener);
  }
  exportPdf(sources?: readonly [string, string][], signal?: AbortSignal): Promise<PdfOutcome> {
    if (this.stopped) return Promise.resolve({ error: this.stopped });
    const id = this.nextPdf++;
    return new Promise((resolve) => {
      const finish = (outcome: PdfOutcome) => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        this.pdfWaiters.delete(id);
        resolve(outcome);
      };
      const abort = () => finish({ error: "Export cancelled." });
      const timer = setTimeout(() => finish({ error: "PDF export timed out. Retry the preview and export again." }), 60_000);
      this.pdfWaiters.set(id, finish);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) return abort();
      this.send({ type: "export-pdf", id, ...(sources ? { sources } : {}) });
    });
  }
  terminate(): void { this.fail("The manuscript was closed."); }
}
