// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Editor, type EditorProps, type RetainedEditor } from "./Editor.js";

beforeEach(() => {
  // Layout is exercised in the real-browser recovery regression. This test
  // checks CodeMirror's editing facets without jsdom's absent text geometry.
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("advertises paused editing and becomes editable after recovery is reviewed", () => {
  const props: EditorProps = {
    states: new Map<string, RetainedEditor>(), path: "main.md", text: "Collection text",
    readOnly: true, livePreview: false, diagnostics: [],
    completion: { library: [], labels: [], recordPaths: [] },
    insight: { library: new Map(), references: new Map(), labels: new Map() },
    onChange: vi.fn(),
  };
  const rendered = render(<Editor {...props} />);
  const editor = () => {
    const element = rendered.container.querySelector<HTMLElement>(".cm-editor");
    if (!element) throw new Error("Missing editor");
    return EditorView.findFromDOM(element)!;
  };
  expect(editor().state.readOnly).toBe(true);
  expect(editor().contentDOM.getAttribute("contenteditable")).toBe("false");
  expect(editor().contentDOM.getAttribute("aria-readonly")).toBe("true");
  rendered.rerender(<Editor {...props} readOnly={false} />);
  expect(editor().state.readOnly).toBe(false);
  expect(editor().contentDOM.getAttribute("contenteditable")).toBe("true");
  expect(editor().state.doc.toString()).toBe("Collection text");
});
