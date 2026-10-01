import { describe, expect, it } from "vitest";
import { DraftStore, draftPatch, type LocalDraft } from "./drafts.js";

const memory = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
};
const draft: LocalDraft = { version: 1, body: "local", baseBody: "base", revision: "1", frontmatter: { title: "Local", unrelated: "old" }, baseFrontmatter: { title: "Base", unrelated: "old" }, updated: "2026-01-01" };

describe("local draft recovery", () => {
  it("persists across store instances and isolates collections and paths", () => {
    const storage = memory();
    expect(new DraftStore("one", storage).write("main.md", draft)).toBe(true);
    expect(new DraftStore("one", storage).read("main.md")).toEqual(draft);
    expect(new DraftStore("two", storage).read("main.md")).toBeNull();
    expect(new DraftStore("one", storage).read("other.md")).toBeNull();
    new DraftStore("one", storage).remove("main.md");
    expect(new DraftStore("one", storage).read("main.md")).toBeNull();
  });
  it("only restores settings changed locally, preserving other remote changes", () => {
    expect(draftPatch(draft)).toEqual({ title: "Local" });
  });
  it("reports blocked storage without throwing away the in-memory draft", () => {
    const storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => { throw new Error("blocked"); } };
    const store = new DraftStore("one", storage);
    expect(store.write("main.md", draft)).toBe(false);
    expect(store.read("main.md")).toBeNull();
    expect(() => store.remove("main.md")).not.toThrow();
  });
  it("rejects corrupt or unversioned drafts", () => {
    const storage = memory();
    storage.setItem("mdbase-writer:draft:one:main.md", '{"body":"bad"}');
    expect(new DraftStore("one", storage).read("main.md")).toBeNull();
  });
});
