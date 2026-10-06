import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it, vi } from "vitest";

import { slashCommands } from "./slash.js";

const commands = [
  { id: "footnote", label: "Footnote", syntax: "[^1]", keywords: "note", run: vi.fn() },
  { id: "table", label: "Table", syntax: "| … |", run: vi.fn() },
];
const complete = (doc: string, pos = doc.length) => slashCommands(() => commands)(new CompletionContext(EditorState.create({ doc }), pos, false));

describe("the slash menu", () => {
  it("offers what can be inserted after a slash at a line start or after a space", () => {
    expect((complete("/") as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(["Footnote", "Table"]);
    expect((complete("Some text /fo") as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(["Footnote"]);
    expect((complete("Some text /note") as { options: { label: string }[] }).options.map((o) => o.label)).toEqual(["Footnote"]);
  });
  it("stays out of the way of slashes inside words and paths", () => {
    expect(complete("figures/plan")).toBeNull();
    expect(complete("and/or")).toBeNull();
    expect(complete("/nothing-matches")).toBeNull();
  });
  it("shows each item's Markdown so it can be learned", () => {
    const result = complete("/") as { options: { detail?: string }[] };
    expect(result.options[0]?.detail).toBe("[^1]");
  });
});
