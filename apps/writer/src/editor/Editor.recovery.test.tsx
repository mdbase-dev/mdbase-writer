// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import { render } from "../test/render.js";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Editor, type EditorProps, type RetainedEditor } from "./Editor.js";
import { DEFAULT_LAYOUT } from "../ui/layout.js";
import { runtime } from "../i18n/app.js";
import { loadCodeMirrorPhrases } from "@mdbase-dev/i18n/codemirror";
import { t } from "@lingui/core/macro";

beforeEach(() => {
  // Layout is exercised in the real-browser recovery regression. This test
  // checks CodeMirror's editing facets without jsdom's absent text geometry.
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(0);
});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await runtime.selectLocale("en"); });

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

it.each(["en", "ja", "de"] as const)("reuses %s phrases synchronously across keyed chapter remounts before scroll measurement", async (locale) => {
  await runtime.selectLocale(locale);
  const phrases = await loadCodeMirrorPhrases(locale);
  const props: EditorProps = {
    states: new Map<string, RetainedEditor>(), path: "first.md", text: "First chapter",
    readOnly: false, livePreview: false, diagnostics: [],
    completion: { library: [], labels: [], recordPaths: [] },
    insight: { library: new Map(), references: new Map(), labels: new Map() }, onChange: vi.fn(),
  };
  const rendered = render(<Editor key="first.md" {...props} />);
  await act(async () => { await loadCodeMirrorPhrases(locale); });
  const getView = () => EditorView.findFromDOM(rendered.container.querySelector<HTMLElement>(".cm-editor")!)!;
  expect(getView().state.phrase("Find")).toBe(phrases["Find"]);
  const first = getView();
  const dispatch = vi.spyOn(EditorView.prototype, "dispatch");
  // WorkspaceView uses key={active}: changing props on the same instance hid
  // the regression, since its phrase refs survived while real chapters' didn't.
  rendered.rerender(<Editor key="second.md" {...props} path="second.md" text="Second chapter" />);
  const view = getView();
  expect(view).not.toBe(first);
  const initialPhrase = view.state.phrase("Find");
  dispatch.mockClear();
  await act(async () => { await loadCodeMirrorPhrases(locale); });
  expect(dispatch).not.toHaveBeenCalled();
  expect(initialPhrase).toBe(phrases["Find"]);
  const path = "second.md";
  expect(view.contentDOM.getAttribute("aria-label")).toBe(t`Markdown for ${path}`);
});

it("keeps every source line visible with workspace defaults, wherever the caret is", () => {
  const text = "first\nsecond\n\nthird\nfourth";
  const props: EditorProps = {
    ...DEFAULT_LAYOUT, path: "lines.md", text, readOnly: false, diagnostics: [],
    completion: { library: [], labels: [], recordPaths: [] },
    insight: { library: new Map(), references: new Map(), labels: new Map() }, onChange: vi.fn(),
  };
  const rendered = render(<Editor {...props} />);
  const view = EditorView.findFromDOM(rendered.container.querySelector<HTMLElement>(".cm-editor")!)!;
  const lines = () => [...view.contentDOM.querySelectorAll(".cm-line")].map(el => el.textContent);
  expect(lines()).toEqual(text.split("\n"));
  act(() => view.dispatch({ selection: { anchor: text.length } }));
  expect(lines()).toEqual(text.split("\n"));
  expect(view.state.doc.toString()).toBe(text);
});
