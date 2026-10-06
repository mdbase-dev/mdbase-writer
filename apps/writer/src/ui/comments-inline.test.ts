import { describe, expect, it } from "vitest";

import type { CommentThread } from "@mdbase-writer/core/comments";
import { inlinePieces, threadIsNew } from "./comments.js";

describe("comment text", () => {
  it("renders emphasis, code and links, leaving the rest as written", () => {
    expect(inlinePieces("Is this *Lyell*'s phrase? See `[^note]` and [the book](https://example.org/x), or https://example.org/y.")).toEqual([
      { kind: "text", text: "Is this " },
      { kind: "em", text: "Lyell" },
      { kind: "text", text: "'s phrase? See " },
      { kind: "code", text: "[^note]" },
      { kind: "text", text: " and " },
      { kind: "link", text: "the book", href: "https://example.org/x" },
      { kind: "text", text: ", or " },
      { kind: "link", text: "https://example.org/y", href: "https://example.org/y" },
      { kind: "text", text: "." },
    ]);
    expect(inlinePieces("snake_case_name stays")).toEqual([{ kind: "text", text: "snake_case_name stays" }]);
  });
});

const comment = (createdAt: string, createdBy?: string) => ({ path: `c/${createdAt}.md`, document: "[[a]]", motivation: "commenting" as const, status: "open" as const, createdAt, text: "x", ...(createdBy ? { createdBy } : {}) });

describe("what is new since the last visit", () => {
  const thread: CommentThread = { root: comment("2026-10-01T00:00:00Z", "[[people/sam]]"), replies: [comment("2026-10-05T00:00:00Z", "[[people/jordan]]")] };
  it("marks a thread someone else wrote in after the last visit, but not one's own writing", () => {
    expect(threadIsNew(thread, "2026-10-03T00:00:00Z", "[[people/sam]]")).toBe(true);
    expect(threadIsNew(thread, "2026-10-03T00:00:00Z", "[[people/jordan]]")).toBe(false);
    expect(threadIsNew(thread, "2026-10-06T00:00:00Z", undefined)).toBe(false);
    expect(threadIsNew(thread, undefined, undefined)).toBe(false);
  });
});
