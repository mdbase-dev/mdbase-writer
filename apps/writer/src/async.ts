// Network operations must fail visibly, be bounded, and be retryable.
export const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export async function fetchChecked(url: string, signal?: AbortSignal): Promise<Response> {
  const response = await fetch(url, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Could not load ${url.split("/").pop()}: HTTP ${response.status}.`);
  return response;
}

/** A shared read budget, including overlapping renders and nested traversals. */
export function limitConcurrency(limit: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(operation: () => Promise<T>): Promise<T> => {
    if (active < limit) active++;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try { return await operation(); }
    finally {
      const next = waiting.shift();
      if (next) next(); // hand the occupied slot directly to the queued reader
      else active--;
    }
  };
}

/** Bound background reads without delaying the initial list of records. */
export async function mapConcurrent<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await run(items[index] as T);
    }
  }));
  return results;
}
