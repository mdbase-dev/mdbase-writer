import { describe, expect, it } from "vitest";

import { DraftStore, type LocalDraft } from "./drafts.js";

function memory(): Storage {
  const map = new Map<string, string>();
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k), clear: () => map.clear(), key: (i) => [...map.keys()][i] ?? null, get length() { return map.size; } };
}
const draft = (updated: string): LocalDraft => ({ version: 1, body: "b", frontmatter: {}, baseBody: "", baseFrontmatter: {}, revision: "r", updated });

describe("listing local drafts", () => {
  it("lists a namespace's drafts newest first, and no other namespace's", () => {
    const store = memory();
    new DraftStore("demo", store).write("a.md", draft("2026-10-01T00:00:00Z"));
    new DraftStore("demo", store).write("ch/b.md", draft("2026-10-02T00:00:00Z"));
    new DraftStore("other", store).write("c.md", draft("2026-10-03T00:00:00Z"));
    expect(new DraftStore("demo", store).list().map((d) => d.path)).toEqual(["ch/b.md", "a.md"]);
  });
});
