import { ok, type Result } from "./types.js";

/** One lazy collection-scoped value. Failed/superseded reads never poison the cache. */
export class CollectionCache<T> {
  value: T | undefined;
  private job: Promise<Result<T>> | undefined;

  get pending(): Promise<Result<T>> | undefined { return this.job; }

  load(read: () => Promise<Result<T>>): Promise<Result<T>> {
    if (this.value !== undefined) return Promise.resolve(ok(this.value));
    if (this.job) return this.job;
    const job = read();
    this.job = job;
    void job.then((out) => {
      if (this.job !== job) return;
      this.job = undefined;
      if (out.ok) this.value = out.value;
    }, () => { if (this.job === job) this.job = undefined; });
    return job;
  }

  set(value: T): void { this.value = value; this.job = undefined; }
  clear(): void { this.value = undefined; this.job = undefined; }
}
