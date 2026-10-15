import { insertNewlineAndIndent, history, undo, redo } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import { EditorState, type StateCommand, type Transaction } from "@codemirror/state";
import { keymap } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { writerLanguage } from "./language.js";

function editing(doc: string) {
  let state = EditorState.create({ doc, selection: { anchor: doc.length }, extensions: [writerLanguage(), history()] });
  const target = { get state() { return state; }, dispatch(tr: Transaction) { state = tr.state; } };
  return {
    get state() { return state; },
    text() { return state.doc.toString(); },
    enter() {
      const bindings = state.facet(keymap).flat().filter(b => b.key === "Enter" && b.run);
      if (!bindings.some(b => (b.run as StateCommand)(target))) insertNewlineAndIndent(target);
    },
    type(text: string) { for (const ch of text) target.dispatch(state.update(state.replaceSelection(ch), { userEvent: "input.type" })); },
    undo() { return undo(target); }, redo() { return redo(target); },
  };
}

describe("Markdown list editing", () => {
  for (const start of ["- one", "- one\n- two", "1. one\n2. two"]) {
    it(`exits ${JSON.stringify(start)} into a real paragraph`, () => {
      const e = editing(start); e.enter(); e.enter(); e.type("after");
      expect(e.text()).toBe(`${start}\n\nafter`);
      expect(syntaxTree(e.state).topNode.lastChild?.name).toBe("Paragraph");
    });
  }
  for (const [start, text, result] of [["- one", "- two", "- one\n- two"], ["- one", "* two", "- one\n* two"], ["1. one", "2. two", "1. one\n2. two"], ["- parent\n  - child", "- next", "- parent\n  - child\n  - next"]]) {
    it(`does not double a manually typed marker after ${JSON.stringify(start)}`, () => {
      const e = editing(start!); e.enter(); e.type(text!); expect(e.text()).toBe(result);
    });
  }
  it("keeps automatic continuation when only item text is typed", () => {
    const e = editing("- one"); e.enter(); e.type("two"); expect(e.text()).toBe("- one\n- two");
  });
  it("does not mistake a numeric item body for an explicit numbered marker", () => {
    const e = editing("1. one"); e.enter(); e.type("2026 is a year"); expect(e.text()).toBe("1. one\n2. 2026 is a year");
  });
  it("preserves explicitly authored nested Markdown", () => {
    const e = editing("- "); e.type("- nested"); expect(e.text()).toBe("- - nested");
  });
  it("keeps ordinary Enter as a literal newline and round-trips undo/redo", () => {
    const e = editing("plain"); e.enter(); e.type("next"); const body=e.text(); expect(body).toBe("plain\nnext");
    expect(e.undo()).toBe(true); expect(e.redo()).toBe(true); expect(e.text()).toBe(body);
  });
});
