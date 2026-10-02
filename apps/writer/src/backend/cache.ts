import type { Result } from "./types.js";

/** One lazy collection-scoped value. Failed/superseded reads never poison the cache. */
export class CollectionCache<T> {
  private result: { readonly ok: true; readonly value: T } | undefined;
  get value(): T | undefined { return this.result?.value; }
  private job: Promise<Result<T>> | undefined;

  get pending(): Promise<Result<T>> | undefined { return this.job; }

  load(read: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.result) return Promise.resolve(this.result);
    if (this.job) return this.job;
    const job = read();
    this.job = job;
    void job.then((out) => {
      if (this.job !== job) return;
      this.job = undefined;
      if (out.ok) this.result = out;
    }, () => { if (this.job === job) this.job = undefined; });
    return job;
  }

  set(value: T): void { this.result = { ok: true, value }; this.job = undefined; }
  clear(): void { this.result = undefined; this.job = undefined; }
}
