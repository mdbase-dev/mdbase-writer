import { afterEach, expect, it, vi } from "vitest";
import { fetchChecked, limitConcurrency, mapConcurrent } from "./async.js";

afterEach(() => vi.unstubAllGlobals());
it("rejects HTTP failures instead of parsing an error page as an asset", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("offline", { status: 503 })));
  await expect(fetchChecked("/fonts/font.otf")).rejects.toThrow("HTTP 503");
});
it("preserves ordering and bounds concurrent background reads", async () => {
  let active = 0;
  let highest = 0;
  const result = await mapConcurrent([1, 2, 3, 4, 5], 2, async (value) => {
    highest = Math.max(highest, ++active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return value * 2;
  });
  expect(result).toEqual([2, 4, 6, 8, 10]);
  expect(highest).toBe(2);
});
it("shares a concurrency budget across overlapping traversals and releases failed slots", async () => {
  const limit = limitConcurrency(2);
  let active = 0;
  let highest = 0;
  const operations = Array.from({ length: 12 }, (_, i) => limit(async () => {
    highest = Math.max(highest, ++active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    if (i === 3) throw new Error("read failed");
    return i;
  }));
  await Promise.allSettled(operations);
  expect(highest).toBe(2);
  expect(await limit(async () => "still usable")).toBe("still usable");
});
