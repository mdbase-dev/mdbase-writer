import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { joinSoftBreaks, softBreaks } from "./join-lines.js";
import { writerLanguage } from "./language.js";

/** The body with each soft break shown joined drawn as "⏎". */
function joined(doc: string): string {
  const state = EditorState.create({ doc, extensions: writerLanguage() });
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

  it("joins a field's soft breaks as spaces", () => {
    expect(joinSoftBreaks("An abstract \n  wrapped\nby hand.\n\nSecond  \nline")).toBe("An abstract wrapped by hand.\n\nSecond  \nline");
  });
});
