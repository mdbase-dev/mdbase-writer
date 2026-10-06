import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import { slashCommands } from "./slash.js";

const commands = [
  { id: "footnote", label: "Footnote", syntax: "[^1]", keywords: "note", run: vi.fn() },
  { id: "table", label: "Table", syntax: "| … |", run: vi.fn() },
];
const complete = (doc: string, pos = doc.length) => {
  const result = slashCommands(() => commands)(new CompletionContext(EditorState.create({ doc }), pos, false));
  if (result instanceof Promise) throw new Error("The slash menu is synchronous.");
  return result;
};
const labels = (doc: string) => complete(doc)?.options.map((o) => o.label) ?? null;

describe("the slash menu", () => {
  it("offers what can be inserted after a slash at a line start or after a space", () => {
    expect(labels("/")).toEqual(["Footnote", "Table"]);
    expect(labels("Some text /fo")).toEqual(["Footnote"]);
    expect(labels("Some text /note")).toEqual(["Footnote"]);
  });
  it("stays out of the way of slashes inside words and paths", () => {
    expect(complete("figures/plan")).toBeNull();
    expect(complete("and/or")).toBeNull();
    expect(complete("/nothing-matches")).toBeNull();
  });
  it("shows each item's Markdown so it can be learned", () => {
    expect(complete("/")?.options[0]?.detail).toBe("[^1]");
  });
});
