import { describe, expect, it } from "vitest";
import type { RecordView } from "../workspace/workspace.js";
import { ManuscriptStats } from "./stats.js";
const view = (body: string, state = "saved") => ({ snapshot: { body, state } }) as unknown as RecordView;
describe("body-derived stats", () => {
  it("ignores save-state changes and preserves citation/label identities during ordinary typing", () => {
    const cache = new ManuscriptStats(), order = ["main.md", "chapter.md"];
    const library = [{ key: "book", path: "book.md", title: "Book", item: { id: "book" } }];
    const records = new Map([["main.md", view("# Main {#sec-main}\n\nA claim [@book].")], ["chapter.md", view("A chapter")]]);
    const first = cache.derive(order, records, library);
    records.set("main.md", view(records.get("main.md")!.snapshot.body, "saving"));
    expect(cache.derive(order, records, library)).toBe(first);
    records.set("chapter.md", view("A chapter with new words"));
    const next = cache.derive(order, records, library);
    expect(next.words).toBeGreaterThan(first.words);
    expect(next.cited).toBe(first.cited); expect(next.labels).toBe(first.labels);
    records.set("main.md", view("No citation"));
    expect(cache.derive(order, records, library).cited.size).toBe(0);
    records.set("chapter.md", view("A chapter with new words", "deleted"));
    expect(cache.derive(order, records, library).words).toBe(2);
  });
});
