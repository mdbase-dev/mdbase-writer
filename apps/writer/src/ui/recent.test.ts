import { describe, expect, it } from "vitest";

import { recentManuscripts, recordOpened, setWordGoal, wordGoal } from "./recent.js";

function memory(): Storage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k), clear: () => map.clear(), key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; } };
}

describe("what the home screen remembers", () => {
  it("lists manuscripts most recently opened first, without repeats", () => {
    const store = memory();
    recordOpened("demo", "a.md", store, new Date("2026-10-01T00:00:00Z"));
    recordOpened("demo", "b.md", store, new Date("2026-10-02T00:00:00Z"));
    recordOpened("demo", "a.md", store, new Date("2026-10-03T00:00:00Z"));
    expect(recentManuscripts("demo", store).map((e) => e.path)).toEqual(["a.md", "b.md"]);
    expect(recentManuscripts("other", store)).toEqual([]);
  });
  it("keeps a word goal per manuscript and removes it when cleared", () => {
    const store = memory();
    setWordGoal("demo", "a.md", 8000, store);
    expect(wordGoal("demo", "a.md", store)).toBe(8000);
    setWordGoal("demo", "a.md", null, store);
    expect(wordGoal("demo", "a.md", store)).toBeNull();
  });
  it("ignores unreadable stored values", () => {
    const store = memory();
    store.setItem("mdbase-writer:recent:demo", "{not json");
    expect(recentManuscripts("demo", store)).toEqual([]);
  });
});
