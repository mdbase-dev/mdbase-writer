// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "../test/render.js";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { fail, ok, type CollectionIndex, type ManuscriptSummary, type Result, type WriterBackend } from "../backend/types.js";
import { Home } from "./Home.js";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  class Observer implements IntersectionObserver {
    observe() {} disconnect() {} unobserve() {} takeRecords(): IntersectionObserverEntry[] {return [];}
    readonly root = null; readonly rootMargin = ""; readonly thresholds: readonly number[] = [];
  }
  globalThis.IntersectionObserver ??= Observer;
});
afterEach(cleanup);

const message = 'Writer can\'t use the "native-comment" type because its definition has an error. Comments that use it are unavailable until the type is fixed; everything else still works.';
function backend(index: CollectionIndex, manuscripts: Result<ManuscriptSummary[]> = ok([])): WriterBackend {
  // Explicit UI metadata stand-in, never native operation/authority evidence.
  const unsupported = async () => fail<never>("This Home fixture cannot mutate records.");
  return {
    kind: "connect", collectionName: "Writing", draftNamespace: "home-test",
    records: {open: async () => {throw new Error("This Home fixture cannot open record leases.");}},
    listManuscripts: async () => manuscripts, library: async () => ok([]), index: async () => ok(index),
    createManuscript: unsupported, adoptManuscript: unsupported, createRecord: unsupported,
    annotationPaths: unsupported, annotationsForSource: unsupported, readFile: unsupported,
    comments: unsupported, createComment: unsupported, changeComment: unsupported,
    people: async () => ({names: new Map()}),
    readBody: async () => ok(""), onExternalChange: () => () => {}, dispose: () => {},
  };
}

it("lists untyped records with a calm No type label and opens them", async () => {
  const onOpen = vi.fn();
  render(<Home backend={backend({recordPaths: ["notes/loose.md", "notes/typed.md"], filePaths: [], notePaths: ["notes/loose.md", "notes/typed.md"], untypedPaths: ["notes/loose.md"]})} onOpen={onOpen} />);
  const row = await screen.findByRole("button", {name: /loose/});
  expect(row.textContent).toContain("No type");
  expect(screen.queryByRole("button", {name: /typed/})).toBeNull();
  fireEvent.click(row);
  expect(onOpen).toHaveBeenCalledWith("notes/loose.md");
});

it("orders by record modification time and reorders on collection notifications", async () => {
  let manuscripts: ManuscriptSummary[] = [
    {path: "z.md", title: "A title", modified: "2026-02-01T00:00:00Z"},
    {path: "a.md", title: "Z title", modified: "2026-02-01T00:00:00Z"},
    {path: "old.md", title: "Older", modified: "2026-01-01T00:00:00Z"},
  ];
  let notify: Parameters<NonNullable<WriterBackend["onCollectionChange"]>>[0] = () => {};
  const fixture: WriterBackend = {
    ...backend({recordPaths: manuscripts.map(record => record.path), notePaths: [], filePaths: []}),
    listManuscripts: async () => ok(manuscripts),
    onCollectionChange: listener => {notify = listener; return () => {};},
  };
  const view = render(<Home backend={fixture} onOpen={vi.fn()} />);
  const paths = () => [...view.container.querySelectorAll(".manuscript-row")].map(row => row.getAttribute("data-path"));
  await waitFor(() => expect(paths()).toEqual(["a.md", "z.md", "old.md"]));
  // A local edit and then a sync/reset both take the new per-record metadata.
  manuscripts = manuscripts.map(record => record.path === "old.md" ? {...record, modified: "2026-03-01T00:00:00Z"} : record);
  act(() => notify({paths: ["old.md"]}));
  await waitFor(() => expect(paths()).toEqual(["old.md", "a.md", "z.md"]));
  manuscripts = manuscripts.map(record => record.path === "z.md" ? {...record, modified: "2026-04-01T00:00:00Z"} : record).reverse();
  act(() => notify({paths: ["z.md"], reset: true}));
  await waitFor(() => expect(paths()).toEqual(["z.md", "old.md", "a.md"]));
});

it("names an unavailable type plainly, once, without blocking the rest", async () => {
  render(<Home backend={backend({recordPaths: [], filePaths: [], notePaths: [], unavailableTypes: [{name: "native-comment", message}]}, fail(message))} onOpen={vi.fn()} />);
  expect(await screen.findByText(message)).toBeTruthy();
  expect(screen.getAllByText(message)).toHaveLength(1);
  expect(screen.queryByRole("button", {name: "Retry loading"})).toBeNull();
});
