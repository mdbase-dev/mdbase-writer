import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { insertLink, toggleFormat, type InlineFormat } from "./formatting.js";

/** Applies a format to `doc`, whose selection is marked with | … |, and returns the result marked the same way. */
function apply(marked: string, format: InlineFormat | "link"): string {
  const from = marked.indexOf("|");
  const to = marked.indexOf("|", from + 1) - 1;
  const doc = marked.replaceAll("|", "");
  const state = EditorState.create({ doc, selection: EditorSelection.range(from, to) });
  const next = state.update(format === "link" ? insertLink(state) : toggleFormat(state, format)).state;
  const { from: a, to: b } = next.selection.main;
  const text = next.doc.toString();
  return `${text.slice(0, a)}|${text.slice(a, b)}|${text.slice(b)}`;
}

describe("inline formatting", () => {
  it("wraps a selection, and unwraps it again", () => {
    expect(apply("a |word| b", "bold")).toBe("a **|word|** b");
    expect(apply("a **|word|** b", "bold")).toBe("a |word| b");
    expect(apply("a |**word**| b", "bold")).toBe("a |word| b");
    expect(apply("a |word| b", "italic")).toBe("a *|word|* b");
    expect(apply("a *|word|* b", "italic")).toBe("a |word| b");
    expect(apply("a |word| b", "code")).toBe("a `|word|` b");
  });

  it("tells bold from italic", () => {
    expect(apply("**|word|**", "italic")).toBe("***|word|***");
    expect(apply("***|word|***", "italic")).toBe("**|word|**");
    expect(apply("***|word|***", "bold")).toBe("*|word|*");
    expect(apply("*|word|*", "bold")).toBe("***|word|***");
  });

  it("leaves markers to type between when nothing is selected", () => {
    expect(apply("a || b", "bold")).toBe("a **||** b");
  });

  it("makes a link with its address selected", () => {
    expect(apply("see |the paper| here", "link")).toBe("see [the paper](|address|) here");
  });
});
