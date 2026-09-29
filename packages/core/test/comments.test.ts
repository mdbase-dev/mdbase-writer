import { describe, expect, it } from "vitest";

import {
  applySuggestion,
  bodyHash,
  codePointOffset,
  commentFromRecord,
  commentThreads,
  linkPath,
  locate,
  recordLink,
  targetFor,
  utf16Offset,
  type CommentRecord,
} from "../src/comments.js";

const body = "# Method\n\nThe evidence suggests strongly that it works. Later, the evidence suggests strongly otherwise.\n";
const hash = `sha256:${"0".repeat(64)}`;
const second = body.lastIndexOf("suggests strongly");

describe("offsets", () => {
  it("counts code points, not UTF-16 units", () => {
    const text = "a😀b";
    expect(codePointOffset(text, 3)).toBe(2);
    expect(utf16Offset(text, 2)).toBe(3);
    expect(utf16Offset(text, 99)).toBe(text.length);
  });

  it("hashes the UTF-8 body", async () => {
    expect(await bodyHash("")).toBe("sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

describe("locate", () => {
  const target = targetFor(body, second, second + "suggests strongly".length, hash);

  it("uses the recorded position while the quote is there", () => {
    expect(locate(body, target)).toEqual({ from: second, to: second + 17 });
  });

  it("follows the quote when text before it changes", () => {
    const edited = `Preface.\n\n${body}`;
    const at = locate(edited, target);
    expect(at).toEqual({ from: second + 10, to: second + 27 });
  });

  it("tells repeated quotes apart by their surroundings, not the nearest one", () => {
    // The recorded position now points at the first occurrence's surroundings.
    const edited = body.replace("# Method\n\n", "");
    expect(locate(edited, { quote: target.quote, text_position: { ...target.text_position!, start: 0, end: 0 } })).toEqual({
      from: edited.lastIndexOf("suggests strongly"),
      to: edited.lastIndexOf("suggests strongly") + 17,
    });
  });

  it("detaches a thread whose quote was deleted", () => {
    expect(locate(body.replaceAll("suggests strongly", "shows"), target)).toBeNull();
  });

  it("finds a quote without a recorded position", () => {
    expect(locate(body, { quote: { exact: "it works" } })).toEqual({ from: body.indexOf("it works"), to: body.indexOf("it works") + 8 });
  });

  it("finds an insertion point by the text either side", () => {
    const at = body.indexOf(" that it");
    const point = targetFor(body, at, at, hash);
    expect(point.quote.exact).toBe("");
    expect(locate(`Preface. ${body}`, point)).toEqual({ from: at + 9, to: at + 9 });
    expect(locate(body.replace(" that it", " so it"), point)).toBeNull();
  });

  it("measures positions in code points", () => {
    const text = "😀 mark this";
    const t = targetFor(text, 3, 7, hash);
    expect(t.text_position).toMatchObject({ start: 2, end: 6 });
    expect(locate(text, t)).toEqual({ from: 3, to: 7 });
  });
});

describe("suggestions", () => {
  it("replaces the located quote", () => {
    const target = targetFor(body, second, second + 17, hash);
    expect(applySuggestion(body, target, "suggests")).toBe(body.slice(0, second) + "suggests" + body.slice(second + 17));
  });

  it("deletes with an empty replacement and inserts at a point", () => {
    const start = body.indexOf(" strongly");
    expect(applySuggestion(body, targetFor(body, start, start + 9, hash), "")).toContain("The evidence suggests that");
    const point = body.indexOf(" that it");
    expect(applySuggestion(body, targetFor(body, point, point, hash), ", clearly,")).toContain("suggests strongly, clearly, that it");
  });

  it("refuses when the quote is gone", () => {
    expect(applySuggestion("Nothing here.", { quote: { exact: "suggests" } }, "shows")).toBeNull();
  });
});

describe("records and threads", () => {
  const record = (path: string, fields: Record<string, unknown>, text = "") =>
    commentFromRecord(path, { document: "[[chapters/method]]", created_at: "2026-09-29T10:00:00Z", ...fields }, text) as CommentRecord;

  it("reads the contract's fields", () => {
    const c = record("comments/a.md", {
      motivation: "editing",
      target: { quote: { exact: "x", prefix: "a " }, text_position: { basis: { profile: "markdown-body", hash }, unit: "unicode_code_point", start: 2, end: 3 } },
      suggestion: { replacement: "y" },
      created_by: "[[Alex Rivera]]",
    }, "\nToo strong?\n");
    expect(c).toMatchObject({ motivation: "editing", status: "open", suggestion: { replacement: "y" }, createdBy: "[[Alex Rivera]]", text: "Too strong?" });
    expect(c.target?.text_position?.start).toBe(2);
  });

  it("rejects records without a document or creation time", () => {
    expect(commentFromRecord("c.md", { created_at: "2026-09-29T10:00:00Z" }, "")).toBeNull();
    expect(commentFromRecord("c.md", { document: "[[a]]" }, "")).toBeNull();
  });

  it("groups replies under their thread, oldest first", () => {
    const root = record("comments/root.md", {});
    const late = record("comments/late.md", { in_reply_to: "[[comments/root]]", created_at: "2026-09-29T12:00:00Z" });
    const early = record("comments/early.md", { in_reply_to: "[[comments/root|the thread]]", created_at: "2026-09-29T11:00:00Z" });
    const stray = record("comments/stray.md", { in_reply_to: "[[comments/deleted]]", created_at: "2026-09-29T09:00:00Z" });
    const threads = commentThreads([late, root, early, stray]);
    expect(threads.map((t) => t.root.path)).toEqual(["comments/stray.md", "comments/root.md"]);
    expect(threads[1]?.replies.map((r) => r.path)).toEqual(["comments/early.md", "comments/late.md"]);
  });

  it("links records by path without the extension", () => {
    expect(recordLink("chapters/method.md")).toBe("[[chapters/method]]");
    expect(linkPath("[[chapters/method|Method]]")).toBe("chapters/method");
    expect(linkPath("[[chapters/method#Results]]")).toBe("chapters/method");
  });
});
