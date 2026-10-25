// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { msg } from "@lingui/core/macro";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { render } from "../test/render.js";
import { i18n, runtime } from "./app.js";
import { diagnosticMessage } from "./diagnostics.js";
import { ok, type CollectionIndex, type ManuscriptSummary, type WriterBackend } from "../backend/types.js";
import { Home } from "../ui/Home.js";
import { CompareDialog } from "../ui/CompareDialog.js";

vi.mock("@mdbase-dev/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <section role="dialog">{children}</section> : null,
}));
beforeAll(() => {
  class Observer implements IntersectionObserver {
    observe() {} disconnect() {} unobserve() {} takeRecords(): IntersectionObserverEntry[] { return []; }
    readonly root = null; readonly rootMargin = ""; readonly thresholds: readonly number[] = [];
  }
  globalThis.IntersectionObserver ??= Observer;
});
afterEach(async () => { cleanup(); vi.restoreAllMocks(); await runtime.selectLocale("en"); });

// Literal user text that Lingui would otherwise decode or parse as markup.
const backslashes = String.raw`C:\x41dir\u0042\u005c`;
const markup = "Draft <0/> <b>notes</b>";

it("passes literal backslash sequences through both Lingui call forms without changing inputs", () => {
  const descriptor = msg({ message: "Review {0}" });
  const values = { 0: backslashes };
  expect(i18n._({ ...descriptor, values })).toBe(`Review ${backslashes}`);
  expect(i18n._(descriptor.id, values)).toBe(`Review ${backslashes}`);
  expect(i18n.t(descriptor.id, values)).toBe(`Review ${backslashes}`);
  expect(values).toEqual({ 0: backslashes });
});

it.each(["en", "it"] as const)("shows literal backslash sequences in record names in %s", async (locale) => {
  await runtime.selectLocale(locale);
  const message = diagnosticMessage("", { code: "embed-missing", values: [backslashes] });
  expect(message).toContain(`![[${backslashes}]]`);
});

function backend(index: CollectionIndex, manuscripts: ManuscriptSummary[]): WriterBackend {
  const unsupported = async () => { throw new Error("This fixture cannot mutate records."); };
  return {
    kind: "connect", collectionName: "Writing", draftNamespace: "boundary-test",
    records: { open: async () => { throw new Error("This fixture cannot open record leases."); } },
    listManuscripts: async () => ok(manuscripts), library: async () => ok([]), index: async () => ok(index),
    createManuscript: unsupported, adoptManuscript: unsupported, createRecord: unsupported,
    annotationPaths: unsupported, annotationsForSource: unsupported, readFile: unsupported,
    comments: unsupported, createComment: unsupported, changeComment: unsupported,
    people: async () => ({ names: new Map() }),
    readBody: async () => ok(""), onExternalChange: () => () => {}, dispose: () => {},
  } as unknown as WriterBackend;
}

it.each(["en", "it"] as const)("renders markup-shaped and backslashed user paths and filters literally in %s", async (locale) => {
  await runtime.selectLocale(locale);
  const path = `notes/${markup} ${backslashes}.md`;
  const manuscripts = Array.from({ length: 6 }, (_, i) => ({ path: `m${i}.md`, title: `Manuscript ${i}` }));
  render(<Home backend={backend({ recordPaths: [path], filePaths: [], notePaths: [path], untypedPaths: [path] }, manuscripts)} onOpen={vi.fn()} />);
  const meta = await screen.findByText((_, element) => element?.className === "manuscript-meta" && element.textContent?.includes("notes/") === true);
  expect(meta.textContent).toContain(path);
  const search = screen.getByRole<HTMLInputElement>("searchbox");
  const { fireEvent } = await import("@testing-library/react");
  const filter = "<1>no</1> such <i>manuscript</i>";
  fireEvent.change(search, { target: { value: filter } });
  expect(document.body.textContent).toContain(filter);
});

it("keeps both comparison panes, and their scroll to the change, when the language changes", async () => {
  const prefix = Array.from({ length: 100 }, (_, index) => `Unchanged line ${index}`).join("\n");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return { top: this.tagName === "MARK" ? 1000 : 100 } as DOMRect;
  });
  const rendered = render(<CompareDialog comparison={{ path: "main.md", kind: "draft", mine: `${prefix}\nLocal`, theirs: `${prefix}\nSaved`, mineFields: {}, theirFields: {} }} onClose={vi.fn()} onResolve={vi.fn()} onDownload={vi.fn()} />);
  const panes = () => [...rendered.container.querySelectorAll<HTMLElement>(".compare-text")];
  const before = panes();
  expect(before.map((pane) => pane.scrollTop)).toEqual([868, 868]);
  await act(async () => { await runtime.selectLocale("it"); });
  expect(panes()).toEqual(before);
  expect(panes().map((pane) => pane.scrollTop)).toEqual([868, 868]);
});
