import { history, isolateHistory, redo, undo } from "@codemirror/commands";
import { insertNewlineContinueMarkup } from "@codemirror/lang-markdown";
import { EditorState, type Transaction } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { joinLines, joinSoftBreaks, softBreaks } from "./join-lines.js";
import { writerLanguage } from "./language.js";

/** The body with each soft break shown joined drawn as "⏎". */
function joined(doc: string): string {
  // These paragraphs are being read, while the caret is elsewhere.
  const text = `${doc}\n\n# Editing elsewhere`;
  const state = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: writerLanguage() });
  let out = "";
  let at = 0;
  for (const { from, to } of softBreaks(state)) {
    out += `${doc.slice(at, from)}⏎`;
    at = to;
  }
  return out + doc.slice(at);
}

describe("joining hard-wrapped lines", () => {
  it("joins a paragraph's lines, not paragraphs", () => {
    expect(joined("One line\nand the next.\n\nA new paragraph\ngoes on.")).toBe("One line⏎and the next.\n\nA new paragraph⏎goes on.");
  });

  it("keeps hard breaks, headings, lists, code and chapter embeds on their own lines", () => {
    expect(joined("Two spaces  \nkeep a break.\nA backslash\\\nkeeps one too.")).toBe("Two spaces  \nkeep a break.⏎A backslash\\\nkeeps one too.");
    expect(joined("# Heading\nText\n\n- one\n- two\n\n```\na\nb\n```")).toBe("# Heading\nText\n\n- one\n- two\n\n```\na\nb\n```");
    expect(joined("Before the chapter\n![[chapters/one]]")).toBe("Before the chapter\n![[chapters/one]]");
  });

  it("joins a list item's and a footnote's continuation lines past their indent", () => {
    expect(joined("- an item\n  continued")).toBe("- an item⏎continued");
    expect(joined("[^a]: A note\n    continued.")).toBe("[^a]: A note⏎continued.");
  });

  it("keeps new Enters visible in the active paragraph, including its following empty line", () => {
    for (const doc of ["One\nTwo\nThree\nAfter", "- one\n- two\n- three\nafter"]) {
      for (const ending of ["", "\n"]) {
        const text = doc + ending;
        const state = EditorState.create({ doc: text, selection: { anchor: text.length }, extensions: [writerLanguage(), joinLines()] });
        expect(softBreaks(state)).toEqual([]);
      }
    }
  });

  it("reveals a paragraph's breaks when the caret moves into it without changing its source", () => {
    const doc = "# Elsewhere\n\nOne\nTwo\nThree";
    let state = EditorState.create({ doc, extensions: [writerLanguage(), joinLines()] });
    expect(softBreaks(state)).toHaveLength(2);
    state = state.update({ selection: { anchor: doc.length } }).state;
    expect(softBreaks(state)).toEqual([]);
    expect(state.doc.toString()).toBe(doc);
    state = state.update({ selection: { anchor: 0 } }).state;
    expect(softBreaks(state)).toHaveLength(2);
  });

  it("list Enter, leaving the list, undo and redo preserve the exact body and visible breaks", () => {
    const doc = "- one\n- two\n- three";
    let state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [writerLanguage(), history(), joinLines()] });
    const target = { get state() { return state; }, dispatch(tr: Transaction) { state = tr.state; } };
    expect(insertNewlineContinueMarkup(target)).toBe(true);
    expect(state.doc.toString()).toBe(`${doc}\n- `);
    expect(insertNewlineContinueMarkup(target)).toBe(true);
    const before = state.doc.toString();
    target.dispatch(state.update(state.replaceSelection("after"), { userEvent: "input.type", annotations: isolateHistory.of("full") }));
    const after = state.doc.toString();
    expect(after).toBe(`${doc}\nafter`);
    expect(softBreaks(state)).toEqual([]);
    expect(undo(target)).toBe(true); expect(state.doc.toString()).toBe(before);
    expect(redo(target)).toBe(true); expect(state.doc.toString()).toBe(after);
    expect(softBreaks(state)).toEqual([]);
  });

  it("joins a field's soft breaks as spaces", () => {
    expect(joinSoftBreaks("An abstract \n  wrapped\nby hand.\n\nSecond  \nline")).toBe("An abstract wrapped by hand.\n\nSecond  \nline");
  });
});
