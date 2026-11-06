import { describe, expect, it } from "vitest";

import { recentManuscripts, recordOpened, setWordGoal, wordGoal } from "./recent.js";

function memory(): Storage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k), clear: () => map.clear(), key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; } };
}

describe("what the home screen remembers", () => {
  it("retains the last edited chapter when its manuscript is reopened", () => {
    const store = memory();
    recordOpened("demo", "book.md", store, new Date("2026-11-06T00:00:00Z"), "chapters/second.md");
    recordOpened("demo", "book.md", store, new Date("2026-11-06T01:00:00Z"));
    expect(recentManuscripts("demo", store)[0]).toEqual({ path: "book.md", at: "2026-11-06T01:00:00.000Z", chapter: "chapters/second.md" });
  });
  it("lists manuscripts most recently opened first, without repeats", () => {
    const store = memory();
    recordOpened("demo", "a.md", store, new Date("2026-10-01T00:00:00Z"));
    recordOpened("demo", "b.md", store, new Date("2026-10-02T00:00:00Z"));
    recordOpened("demo", "a.md", store, new Date("2026-10-03T00:00:00Z"));
    expect(recentManuscripts("demo", store).map((e) => e.path)).toEqual(["a.md", "b.md"]);
    expect(recentManuscripts("other", store)).toEqual([]);
  });
  it("keeps a writing position in the existing entry and clears a stale chapter on returning to the main record", () => {
    const store = memory();
    recordOpened("demo", "book.md", store, undefined, "chapters/second.md");
    const position = { path: "book.md", anchor: 12, head: 24, top: 10, offset: -3.5 };
    recordOpened("demo", "book.md", store, undefined, undefined, position);
    recordOpened("demo", "book.md", store);
    expect(recentManuscripts("demo", store)[0]).toMatchObject({ chapter: "book.md", position });
    expect(store.length).toBe(1);
  });
  it("discards malformed optional positions without losing the recent manuscript", () => {
    const store = memory();
    for (const position of [null, {}, { path: "book.md", anchor: -1, head: 2, top: 0, offset: 0 }, { path: "book.md", anchor: 0, head: 2, top: 0, offset: "bad" }]) {
      store.setItem("mdbase-writer:recent:demo", JSON.stringify([{ path: "book.md", at: "today", position }]));
      expect(recentManuscripts("demo", store)).toEqual([{ path: "book.md", at: "today" }]);
    }
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
