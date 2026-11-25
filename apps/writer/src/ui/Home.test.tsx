// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { render } from "../test/render.js";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { MdbasePeopleClient, type DescribeResult, type MdbaseApplicationConnection } from "@mdbase-dev/sdk";
import { MemoryReplica, type MemoryContract } from "@mdbase-dev/sdk/testing";
import manifest from "../generated/mdbase-app.json";
import { NativeWriterBackend } from "../backend/native.js";
import { fail, ok, type CollectionIndex, type ManuscriptSummary, type Result, type WriterBackend } from "../backend/types.js";
import { Home } from "./Home.js";
import { recordOpened } from "./recent.js";

beforeAll(() => {
  globalThis.matchMedia ??= () => ({ matches: true, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true });
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
  class Observer implements IntersectionObserver {
    observe() {} disconnect() {} unobserve() {} takeRecords(): IntersectionObserverEntry[] {return [];}
    readonly root = null; readonly rootMargin = ""; readonly thresholds: readonly number[] = [];
  }
  globalThis.IntersectionObserver ??= Observer;
});
afterEach(() => { cleanup(); localStorage.clear(); });

it("offers Continue only for a manuscript in real open history, not missing modification times", async () => {
  const manuscripts = [{ path: "a.md", title: "Never opened" }, { path: "z.md", title: "Actually opened" }];
  const fixture = backend({ recordPaths: manuscripts.map(record => record.path), filePaths: [], notePaths: [] }, ok(manuscripts));
  const onOpen = vi.fn();
  const first = render(<Home backend={fixture} onOpen={onOpen} />);
  await screen.findByText("Never opened");
  expect(screen.queryByText("Continue writing")).toBeNull();
  first.unmount();
  recordOpened("home-test", "z.md");
  render(<Home backend={fixture} onOpen={onOpen} />);
  const continuing = await screen.findByRole("button", { name: "Continue" });
  expect(continuing.closest("section")?.textContent).toContain("Actually opened");
  fireEvent.click(continuing);
  expect(onOpen).toHaveBeenCalledWith("z.md");
});

it("keeps title validation in the description rather than the accessible name", async () => {
  render(<Home backend={backend({ recordPaths: [], filePaths: [], notePaths: [] })} onOpen={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "New manuscript" }));
  fireEvent.click(screen.getByRole("button", { name: "Create manuscript" }));
  const title = screen.getByRole("textbox", { name: "Title" });
  expect(title.getAttribute("aria-invalid")).toBe("true");
  expect(title.getAttribute("aria-describedby")).toBe("new-title-problem");
  expect(document.getElementById("new-title-problem")?.closest("label")).toBeNull();
  expect(document.activeElement).toBe(title);
});

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

it("keeps an index refusal out of the banner text until its details are opened", async () => {
  const fixture = backend({recordPaths: [], filePaths: [], notePaths: []});
  fixture.index = async () => ({ok: false, message: "This library is too large to index at once.", details: "too_large: query_budget_exceeded"});
  render(<Home backend={fixture} onOpen={vi.fn()} />);
  expect(await screen.findByText("Index could not be loaded: This library is too large to index at once.")).toBeTruthy();
  const details = screen.getByText("too_large: query_budget_exceeded").closest("details");
  expect(details?.open).toBe(false);
  fireEvent.click(screen.getByText("Technical details"));
  expect(details?.open).toBe(true);
});

it("paints manuscripts from the manuscript contract before scanning the full collection", async () => {
  const definitions = manifest.requirements.contracts.map((contract, index) => ({
    contract,
    type: ["native-manuscript", "native-source", "native-comment"][index] ?? "unknown",
  }));
  const mappings: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    "native-manuscript": {title: "/meta/heading", template: "layout", csl: "style"},
    "native-source": {title: "heading", csl: "citation"},
    "native-comment": {document: "document", motivation: "motivation", status: "status", created_at: "created_at"},
  };
  const description: DescribeResult = {
    specVersion: "0.3.0", settings: {explicit_type_keys: ["type"]}, inclusion: {include: ["image"]}, issues: [],
    contracts: definitions.map(({contract, type}) => ({...contract, path: `_contracts/${contract.id}.md`, contractType: "record", implementedBy: [type]})),
    types: definitions.map(({contract, type}) => ({name: type, path: `_types/${type}.md`, implements: [{contract: contract.id, version: contract.version, fields: {...mappings[type]}}]})),
  };
  const contracts: MemoryContract[] = description.types.flatMap(type => (type.implements ?? []).map(implementation => {
    const contract = description.contracts.find(candidate => candidate.id === implementation.contract && candidate.version === implementation.version)!;
    return {id: contract.id, version: implementation.version!, type: type.name, contractDigest: contract.digest, fields: implementation.fields ?? {}};
  }));
  const replica = new MemoryReplica({confirmDelayMs: 0, contracts});
  const older = replica.seed({path: "manuscripts/older.md", types: ["native-manuscript"], frontmatter: {type: "native-manuscript", meta: new Map([["heading", "Older Paper"]]), layout: "article", style: "apa"}, body: "Older\n"});
  const tiedZ = replica.seed({path: "manuscripts/z-tied.md", types: ["native-manuscript"], frontmatter: {type: "native-manuscript", meta: new Map([["heading", "A Title"]]), layout: "thesis", style: "chicago-author-date"}, body: "Tied Z\n"});
  const tiedA = replica.seed({path: "manuscripts/a-tied.md", types: ["native-manuscript"], frontmatter: {type: "native-manuscript", meta: new Map([["heading", "Z Title"]]), layout: "article", style: "apa"}, body: "Tied A\n"});
  replica.seed({path: "sources/paper.md", types: ["native-source"], frontmatter: {type: "native-source", heading: "Citation source", citation: new Map([["id", "paper"], ["type", "article-journal"], ["title", "Citation source"]])}, body: "Source\n"});
  replica.seed({path: "notes/loose.md", frontmatter: {}, body: "Loose note\n"});
  const client = await replica.client({app: {name: "writer-home-order-test", version: "test"}});
  const upload = await client.files.upload("figures/plot.png", new Uint8Array([1, 2]));
  await upload.confirmed;

  const times = new Map([
    [older.id, Date.parse("2026-01-01T00:00:00Z")],
    [tiedZ.id, Date.parse("2026-02-01T00:00:00Z")],
    [tiedA.id, Date.parse("2026-02-01T00:00:00Z")],
  ]);
  const calls: string[] = [];
  let releaseScan!: () => void;
  const scanGate = new Promise<void>(resolve => { releaseScan = resolve; });
  let domPathsWhenScanStarted: (string | null)[] | undefined;

  vi.spyOn(client, "describe").mockImplementation(async () => { calls.push("describe"); return description; });
  const originalContract = client.queryContract.bind(client);
  vi.spyOn(client, "queryContract").mockImplementation(async (contract, options) => {
    calls.push(`queryContract:${contract.id}`);
    const result = await originalContract(contract, options);
    return {...result, page: {...result.page, records: result.page.records.map(record => ({...record, ...(times.has(record.id) ? {mtime: times.get(record.id)!} : {})}))}};
  });
  const originalPages = client.pages.bind(client);
  vi.spyOn(client, "pages").mockImplementation(async function* (...args) {
    calls.push("pages");
    domPathsWhenScanStarted ??= [...document.querySelectorAll(".manuscript-row[data-path]")].map(row => row.getAttribute("data-path"));
    await scanGate;
    yield* originalPages(...args);
  });
  const originalListFiles = client.files.listPage.bind(client.files);
  vi.spyOn(client.files, "listPage").mockImplementation(async (...args) => {
    calls.push("files.listPage");
    return originalListFiles(...args);
  });

  const current = () => true;
  const connection: MdbaseApplicationConnection = {
    id: client.collection, displayName: "Writing",
    scope: {account: "fixture-account", installation: "fixture-installation", collection: client.collection},
    generation: "fixture-generation", records: client, files: client.files,
    people: new MdbasePeopleClient(client, {collection: client.collection, request: async () => { throw new Error("Unapproved"); }, isCurrent: current}),
    isCurrent: current,
  };
  const lifetime = new AbortController();
  const nativeBackend = new NativeWriterBackend(connection, {collectionName: "Writing", signal: lifetime.signal});
  try {
    const view = render(<Home backend={nativeBackend} onOpen={vi.fn()} />);
    const manuscriptRows = () => [...view.container.querySelectorAll(".manuscript-row[data-path]")];

    // Manuscripts render in byRecentlyEdited order with their projected fields while the full-collection scan is still blocked.
    await waitFor(() => expect(manuscriptRows().map(row => row.getAttribute("data-path"))).toEqual([
      "manuscripts/a-tied.md", "manuscripts/z-tied.md", "manuscripts/older.md",
    ]));
    expect(manuscriptRows().map(row => row.querySelector(".manuscript-title")?.textContent)).toEqual([
      "Z Title", "A Title", "Older Paper",
    ]);
    expect(manuscriptRows()[1]?.querySelector(".manuscript-meta")?.textContent).toContain("Thesis or book");
    expect(manuscriptRows()[1]?.querySelector(".manuscript-meta")?.textContent).toContain("Chicago (author-date)");
    expect(manuscriptRows()[0]?.querySelector(".manuscript-meta")?.textContent).toContain("Article");
    expect(manuscriptRows()[0]?.querySelector(".manuscript-meta")?.textContent).toContain("APA 7th edition");

    // Describe and manuscript contract paging completed before the full scan started, and manuscripts were already in the DOM when pages() began.
    expect(calls.slice(0, 2)).toEqual(["describe", "queryContract:dev.mdbase.writer.manuscript"]);
    expect(calls).not.toContain("queryContract:dev.mdbase.reader.source");
    expect(calls).not.toContain("files.listPage");
    await waitFor(() => expect(domPathsWhenScanStarted).toEqual([
      "manuscripts/a-tied.md", "manuscripts/z-tied.md", "manuscripts/older.md",
    ]));

    // Release the background scan: source count and untyped notes arrive afterwards without re-querying manuscripts.
    releaseScan();
    expect(await screen.findByText(/1 source to cite from mdbase Reader/)).toBeTruthy();
    expect(await screen.findByRole("button", {name: /Loose/})).toBeTruthy();
    expect(calls).toEqual(["describe", "queryContract:dev.mdbase.writer.manuscript", "pages", "queryContract:dev.mdbase.reader.source", "files.listPage"]);
  } finally {
    nativeBackend.dispose();
    lifetime.abort();
    client.close();
  }
});
