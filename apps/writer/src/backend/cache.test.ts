import { describe, expect, it } from "vitest";
import { CollectionCache } from "./cache.js";
import { fail, ok, type Result } from "./types.js";

describe("collection cache", () => {
  it("shares pending/successful values and retries failures", async () => {
    const cache = new CollectionCache<number>();
    let resolve!: (result: Result<number>) => void;
    const job = cache.load(() => new Promise((done) => { resolve = done; }));
    expect(cache.load(async () => ok(99))).toBe(job);
    resolve(fail("Transient")); await job;
    expect(await cache.load(async () => ok(1))).toEqual(ok(1));
    expect(await cache.load(async () => ok(2))).toEqual(ok(1));
  });
  it("ignores superseded completion after a reset or a delta", async () => {
    const cache = new CollectionCache<number>();
    let resolve!: (result: Result<number>) => void;
    const old = cache.load(() => new Promise((done) => { resolve = done; }));
    cache.clear(); cache.set(2); resolve(ok(1)); await old;
    expect(cache.value).toBe(2);
    cache.clear(); expect(await cache.load(async () => ok(3))).toEqual(ok(3));
  });
  it("evicts rejected promises", async () => {
    const cache = new CollectionCache<number>();
    await expect(cache.load(async () => { throw new Error("Offline"); })).rejects.toThrow("Offline");
    expect(await cache.load(async () => ok(1))).toEqual(ok(1));
  });
});
