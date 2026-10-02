// Run from apps/writer: pnpm exec vitest run --config scripts/perf/vitest.config.ts
// No LAB, accounts, network, or product changes. Real backend/workspace/SDK sessions;
// synthetic query/file transport. Timings are Node proxies, NOT browser paint times.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import type { CollectionDescription, CollectionFileDescriptor, JsonObject, MdbaseConnection, QueryInput, QueryRecord } from "@mdbase-dev/connect";
import { MdbaseCollectionClient, connectFailure, connectProblem, connectSuccess } from "@mdbase-dev/connect/advanced";
import { createRecordTestAuthority } from "@mdbase-dev/connect-testing";
import { PathIndex, resolveLinkTarget } from "@mdbase-writer/core/records";
import { commentFromRecord, commentThreads } from "@mdbase-writer/core/comments";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ConnectBackend, annotationContract, commentContract, manuscriptContract, sourceContract } from "../../src/backend/connect.js";
import { authorYear, searchLibrary } from "../../src/editor/library-search.js";
import { writerCompletions } from "../../src/editor/completions.js";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { placeThreads, ThreadPlacement } from "../../src/ui/comments.js";
import { CommentsPanel } from "../../src/ui/CommentsPanel.js";
import { SourcesPanel } from "../../src/ui/SourcesPanel.js";
import { ManuscriptWorkspace } from "../../src/workspace/workspace.js";
import { labelTargets, referenceKeys } from "../../src/editor/insight.js";
import { wordCount } from "../../src/words.js";

const compiler = vi.hoisted(() => ({ initAt: 0, messages: [] as { type: string; bytes: number; cloneMs: number }[] }));
vi.mock("../../src/compile/client.js", () => ({ CompileClient: class {
  ready = Promise.resolve(0);
  send(message: { type: string }) {
    const start = performance.now();
    if (message.type === "init") compiler.initAt = start;
    structuredClone(message); // Proxy for sender-side structured cloning, not a worker compile.
    const cloneMs = performance.now() - start;
    compiler.messages.push({ type: message.type, cloneMs, bytes: Buffer.byteLength(JSON.stringify(message)) });
  }
  onResult = () => () => {};
  onFailure = () => () => {};
  terminate() {}
} }));
vi.mock("../../src/export/pandoc.js", () => ({ toDocx: vi.fn() }));

import { counts, generateCollection, main } from "./generator.js";
const latencyMs = Number(process.env["PERF_LATENCY_MS"] ?? 20);
const runs = Number(process.env["PERF_RUNS"] ?? 3);
const filePageSize = Number(process.env["PERF_FILE_PAGE_SIZE"] ?? 500);
const strictContracts = process.env["PERF_STRICT_CONTRACTS"] !== "0";
for (const [name, value] of Object.entries({ latencyMs, runs, filePageSize })) {
  if (!Number.isFinite(value) || value < (name === "latencyMs" ? 0 : 1)) throw new Error(`Invalid ${name}`);
}
const delay = () => latencyMs ? new Promise<void>((resolve) => setTimeout(resolve, latencyMs)) : Promise.resolve();
const pad = (n: number) => String(n).padStart(5, "0");
type Transfer = { operation: string; records: number; bodyBytes: number; jsonBytes: number };

function fixture(highlightsPerBook?: number, annotationLatencyFactor = 1) {
  const authority = createRecordTestAuthority();
  const rows: QueryRecord<JsonObject>[] = [];
  const byType = new Map<string, QueryRecord<JsonObject>[]>();
  const transfers: Transfer[] = [];
  const seed = (path: string, type: string, frontmatter: JsonObject, body: string) => {
    const fm = { type, ...frontmatter };
    authority.seed(path, { frontmatter: fm, body });
    const row = { path, types: [type], frontmatter: fm, body, file: { path, mtime: "2026-01-01T00:00:00Z", size: Buffer.byteLength(body) } };
    rows.push(row);
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(row);
  };
  const body = generateCollection(seed, highlightsPerBook);
  const contracts = [
    [manuscriptContract, "writer-manuscript", ["title", "csl", "template"]],
    [sourceContract, "reader-source", ["title", "csl"]],
    [annotationContract, "reader-annotation", ["source", "locator"]],
    [commentContract, "comment", ["document", "created_at", "status", "motivation", "target"]],
  ] as const;
  const description: CollectionDescription = {
    protocolVersion: 1, collectionId: "synthetic-perf", displayName: "Synthetic benchmark", specVersion: "0.3", operations: [], changeCursor: 0, types: [],
    contracts: contracts.map(([contract, typeName, fields]) => ({ ...contract, contractType: "record", digest: "test", schema: {}, implementations: [{ typeName, typeVersion: 1, digest: "test", fields: Object.fromEntries(fields.map((f) => [f, f])) }] })),
  };
  const account = (operation: string, data: unknown, records = 0, bodyBytes = 0) => {
    const text = JSON.stringify(data);
    transfers.push({ operation, records, bodyBytes, jsonBytes: Buffer.byteLength(text) });
    return JSON.parse(text) as typeof data;
  };
  // Inherit SDK queryPages: real page-size/offset logic and independent page budgets.
  // Only the authority query evaluator is synthetic (not a full mdbase type engine).
  class SyntheticClient extends MdbaseCollectionClient<JsonObject> {
    constructor() { super({ operation: async () => { throw new Error("Unexpected raw operation"); } }); }
    override async describe() {
      await delay();
      return connectSuccess(account("describe", description) as CollectionDescription);
    }
    override async query(input: QueryInput = {}) {
      for (let n = 0; n < (input.types?.includes("reader-annotation") && !input.includeBody ? annotationLatencyFactor : 1); n++) await delay();
      if (strictContracts && input.contract && (input.includeBody || input.where || input.select)) {
        const problem = connectProblem<"operation_invalid">("operation_invalid", "Contract views cannot include bodies, filters or selections.", { details: { diagnostics: [] } });
        account("rejected-contract", problem);
        return connectFailure<"operation_invalid">(problem);
      }
      // Fail loudly rather than report optimistic timings for an unsupported future query.
      let paths: Set<string> | undefined;
      if (input.where) {
        const list = /^file\.path in (\[.*\])$/.exec(input.where)?.[1];
        if (!list) throw new Error("Unsupported synthetic where clause");
        const parsed: unknown = JSON.parse(list);
        if (!Array.isArray(parsed) || !parsed.every((p) => typeof p === "string")) throw new Error("Expected an exact path list");
        paths = new Set(parsed);
      }
      if (input.select || input.cursor || input.groupBy || input.orderBy || input.summaryFunctions || input.summaries) throw new Error("Extend synthetic evaluator for the new query shape before comparing results.");
      const type = input.contract ? contracts.find(([c]) => c.id === input.contract!.id)?.[1] : undefined;
      const candidates = type ? byType.get(type)! : input.types ? input.types.flatMap((t) => byType.get(t) ?? []) : rows;
      const matching = paths ? candidates.filter((r) => paths.has(r.path)) : candidates;
      const offset = input.offset ?? 0;
      const limit = input.limit ?? 200;
      const results = matching.slice(offset, offset + limit).map((r) => ({
        path: r.path, types: r.types, file: r.file,
        ...(input.frontmatterMode === "effective" ? { effectiveFrontmatter: r.frontmatter! } : input.frontmatterMode === "both" ? { frontmatter: r.frontmatter!, effectiveFrontmatter: r.frontmatter! } : { frontmatter: r.frontmatter! }),
        ...(input.includeBody ? { body: r.body } : {}),
      }));
      const label = type ?? input.types?.join(",") ?? (input.where ? "changed-paths" : "all-records");
      const value = { results, meta: { hasMore: offset + limit < matching.length, totalCount: matching.length } };
      return connectSuccess(account(`query:${label}`, value, results.length, results.reduce((n, r) => n + Buffer.byteLength(r.body ?? ""), 0)) as typeof value);
    }
  }
  const client = new SyntheticClient();
  const files: CollectionFileDescriptor[] = Array.from({ length: counts.files }, (_, i) => ({ path: `files/image-${pad(i)}.png`, fileId: `file-${i}`, revision: "1", contentDigest: `sha256:${"0".repeat(64)}`, size: 10_000, mediaClass: "image", mediaType: "image/png", modifiedAt: "2026-01-01T00:00:00Z" }));
  const watch = { ...authority.watch, status: { state: "connected" as const, cursor: 0, recovered: false }, problem: null };
  const connection = {
    info: () => ({ displayName: "Synthetic benchmark", collectionId: "synthetic-perf" }),
    describe: client.describe.bind(client), queryPages: client.queryPages.bind(client),
    read: async ({ path }: { path: string }) => {
      await delay();
      const record = authority.get(path);
      if (!record) throw new Error(`Missing benchmark record: ${path}`);
      return connectSuccess(account("record:read", record, 1, Buffer.byteLength(record.body ?? "")) as typeof record);
    },
    watch: async () => connectSuccess(watch),
    records: {
      follow: authority.records.follow.bind(authority.records),
      open: async (...args: Parameters<typeof authority.records.open>) => {
        await delay();
        const result = await authority.records.open(...args);
        if (result.ok) account("record:open", result.value.session.getSnapshot().record, 1, Buffer.byteLength(result.value.session.getSnapshot().body));
        return result;
      },
    },
    people: { directory: async () => { await delay(); account("people", {}); return connectSuccess({ people: [], account: {}, me: { status: "unlinked" } }); } },
    files: { async *list() {
      for (let i = 0; i < files.length; i += filePageSize) {
        await delay();
        const page = files.slice(i, i + filePageSize);
        const copied = account("files:list", page, page.length) as CollectionFileDescriptor[];
        yield* copied;
      }
    } },
  };
  // Deliberately narrow facade: unsupported connection methods cannot be used silently.
  const backend = new ConnectBackend(connection as unknown as MdbaseConnection<JsonObject>);
  return { authority, backend, rows, transfers, body, seed };
}

function totals(events: Transfer[]) {
  const result = { requests: events.length, records: 0, bodyBytes: 0, jsonBytes: 0, byOperation: {} as Record<string, number> };
  for (const e of events) {
    result.records += e.records; result.bodyBytes += e.bodyBytes; result.jsonBytes += e.jsonBytes;
    result.byOperation[e.operation] = (result.byOperation[e.operation] ?? 0) + 1;
  }
  return result;
}
async function until(workspace: ManuscriptWorkspace, predicate: () => boolean) {
  if (predicate()) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { stop(); reject(new Error(`Benchmark readiness timeout: ${JSON.stringify({ phase: workspace.getSnapshot().phase, comments: workspace.getSnapshot().comments.length, annotations: workspace.getSnapshot().annotationPaths.size, commentsProblem: workspace.getSnapshot().commentsProblem })}`)); }, 120_000);
    const stop = workspace.subscribe(() => {
      if (workspace.getSnapshot().phase === "failed") { clearTimeout(timer); stop(); reject(new Error(workspace.getSnapshot().problem)); }
      else if (predicate()) { clearTimeout(timer); stop(); resolve(); }
    });
  });
}
function measure(fn: () => unknown, samples = 7) {
  const values: number[] = [];
  for (let i = 0; i < samples; i++) { const start = performance.now(); fn(); values.push(performance.now() - start); }
  values.sort((a, b) => a - b);
  return { p50Ms: values[Math.floor(values.length / 2)], maxMs: values.at(-1), samples };
}

it("large collection baseline (opt-in)", async () => {
  vi.stubGlobal("fetch", async () => new Response("<xml/>")); // CSL downloads/Typst excluded.
  const output: unknown[] = [];
  try {
    for (let run = 0; run < runs; run++) {
      compiler.messages.length = 0;
      compiler.initAt = 0;
      const seedStart = performance.now();
      const f = fixture();
      const seedMs = performance.now() - seedStart;
      let workspace: ManuscriptWorkspace | undefined;
      try {
        const homeStart = performance.now();
        const homeIndex = f.backend.index();
        const homeLibrary = f.backend.library();
        const manuscripts = await f.backend.listManuscripts();
        const homeListMs = performance.now() - homeStart;
        expect(manuscripts.ok && manuscripts.value.length).toBe(counts.manuscripts);
        await Promise.all([homeIndex, homeLibrary]);
        const homeBackgroundMs = performance.now() - homeStart;
        const homeTransfers = totals(f.transfers.splice(0));

        const start = performance.now();
        workspace = new ManuscriptWorkspace(f.backend, main);
        const milestones: Partial<Record<"comments" | "annotationIndex", number>> = {};
        const mark = () => {
          const snap = workspace!.getSnapshot();
          if (snap.commentsLoad.phase === "ready") milestones.comments ??= performance.now() - start;
          if (snap.annotationsLoad.phase === "ready") milestones.annotationIndex ??= performance.now() - start;
        };
        const stopMarking = workspace.subscribe(mark);
        mark();
        await until(workspace, () => workspace!.getSnapshot().phase === "ready");
        const readyMs = performance.now() - start;
        const readyTransfers = totals([...f.transfers]);
        await until(workspace, () => workspace!.getSnapshot().libraryLoad.phase === "ready");
        const sourceStart = performance.now();
        const library = workspace.getSnapshot().library;
        searchLibrary(library, "research", 60);
        const sourcesUsableMs = performance.now() - start;
        const sourcesFirstSearchMs = performance.now() - sourceStart;
        await until(workspace, () => workspace!.getSnapshot().comments.length === counts.comments / 10);
        const commentsUsableMs = milestones.comments!;
        await until(workspace, () => workspace!.getSnapshot().annotationPaths.size === counts.annotations);
        const annotationIndexMs = milestones.annotationIndex!;
        const sourceAnnotationsStart = performance.now();
        const annotations = await workspace.annotationsForSource(library[0]!.path);
        const sourceAnnotationsMs = performance.now() - sourceAnnotationsStart;
        const annotationsUsableMs = performance.now() - start;
        expect(annotations.ok && annotations.value.length).toBe(counts.annotations / counts.sources);
        await until(workspace, () => workspace!.getSnapshot().indexLoad.phase === "ready");
        await vi.waitFor(() => expect(compiler.initAt).toBeGreaterThan(start), { timeout: 120_000 });
        const previewInitializedMs = compiler.initAt - start;
        stopMarking();
        const commentTransfers = totals(f.transfers.filter((e) => e.operation === "query:comment"));
        const workspaceTransfers = totals(f.transfers.splice(0));
        const returnHomeStart = performance.now();
        await Promise.all([f.backend.index(), f.backend.library(), f.backend.listManuscripts()]);
        const returnHomeMs = performance.now() - returnHomeStart;
        const returnHomeTransfers = totals(f.transfers.splice(0));
        const navigationTransfers = { requests: homeTransfers.requests + workspaceTransfers.requests + returnHomeTransfers.requests, jsonBytes: homeTransfers.jsonBytes + workspaceTransfers.jsonBytes + returnHomeTransfers.jsonBytes };
        const snap = workspace.getSnapshot();
        const cited = new Map<string, number>(Array.from({ length: 100 }, (_, i) => [`source${pad(i)}`, 1] as const));
        const allComments = f.rows.filter((r) => r.types.includes("comment")).map((r) => commentFromRecord(r.path, r.frontmatter, r.body ?? "")!).filter(Boolean);
        const fullPathPlacement = () => placeThreads(allComments, [main], (p) => p === main ? f.body : undefined, snap.recordIndex);
        const placed = fullPathPlacement();
        expect(placed.length).toBe(300);
        const noop = () => {};
        const ok = async () => ({ ok: true as const, value: undefined });
        const completion = writerCompletions(() => ({ library, recordPaths: snap.recordPaths, labels: [], cited }));
        const completionState = EditorState.create({ doc: "![[" });
        const placementCache = new ThreadPlacement();
        placementCache.place(snap.comments, [main], (p) => p === main ? f.body : undefined, snap.recordIndex);
        const computations = {
          pathIndexBuild58100: measure(() => new PathIndex(snap.recordPaths)),
          placeCachedComments: measure(() => placementCache.place(snap.comments, [main], (p) => p === main ? f.body : undefined, snap.recordIndex)),
          sourceSort5000: measure(() => library.filter((e) => !cited.has(e.key)).sort((a, b) => authorYear(a).localeCompare(authorYear(b)) || a.title.localeCompare(b.title))),
          searchCold5000: measure(() => searchLibrary([...library], "research", 60)),
          searchWarm5000: measure(() => searchLibrary(library, "research", 60)),
          completion58100: measure(() => completion(new CompletionContext(completionState, 3, true))),
          set58100: measure(() => new Set(snap.recordPaths)),
          readingOrder: measure(() => workspace!.readingOrder()),
          chapterPaths100Embeds: measure(() => {
            // Same two per-embed resolution calls as workspace.isChapter + chapterPaths;
            // collection-generation candidates are now shared.
            const candidates = snap.recordIndex;
            for (let i = 0; i < 100; i++) {
              const target = `notes/note-${pad(i)}`;
              resolveLinkTarget(target, main, candidates);
              resolveLinkTarget(target, main, candidates);
            }
          }, 3),
          stats100Records: measure(() => {
            const libraryKeys = new Set(library.map((e) => e.key));
            for (let i = 0; i < 100; i++) { wordCount(f.body); labelTargets(main, f.body); referenceKeys(f.body).filter((key) => libraryKeys.has(key)); }
          }),
          place3000CommentsFullPaths: measure(fullPathPlacement),
          place3000CommentsBareNames: measure(() => placeThreads(allComments.map((c) => ({ ...c, document: `[[${c.document.split("/").at(-1)}` })), [main], (p) => p === main ? f.body : undefined, snap.recordIndex), 1),
          oneThread3000Replies: measure(() => commentThreads([allComments[0]!, ...allComments.slice(1).map((c) => ({ ...c, inReplyTo: `[[${allComments[0]!.path}]]` }))])),
          sourcePanelSSR: measure(() => renderToString(createElement(SourcesPanel, { library, cited, loadAnnotations: () => Promise.resolve(annotations), onInsert: noop, onStepCitation: noop, canInsert: true })), 3),
          commentsPanelSSR: measure(() => renderToString(createElement(CommentsPanel, { placed, people: snap.people, active: null, pending: null, recordTitle: (p) => p, onSelect: noop, onSubmit: ok, onCancel: noop, onReply: ok, onChange: ok, onAccept: ok, onWholeRecord: noop, onCheckAccount: ok })), 3),
          annotationFilter6: measure(() => annotations.ok ? annotations.value.filter((a) => a.source === library[0]!.path || library[0]!.path.endsWith(`/${a.source}`)) : []),
          cloneLibrary5000: measure(() => structuredClone({ type: "library", library: library.map((e) => e.item) })),
        };
        const previousRecords = workspace.getSnapshot().recordPaths;
        const refreshMessagesStart = compiler.messages.length;
        const refreshStart = performance.now();
        f.authority.editElsewhere("notes/note-00000.md", { body: "Changed in another app" });
        await until(workspace, () => {
          const current = workspace!.getSnapshot();
          return current.indexLoad.phase === "ready" && current.libraryLoad.phase === "ready" && current.annotationsLoad.phase === "ready" && (current.recordPaths !== previousRecords || f.transfers.some((t) => t.operation === "query:changed-paths"));
        });
        const externalRefreshMs = performance.now() - refreshStart;
        const externalTransfers = totals(f.transfers.splice(0));
        const noteWorkerMessages = compiler.messages.slice(refreshMessagesStart);
        f.seed("sources/new-source.md", "reader-source", { csl: { id: "newsource", type: "book", title: "A newly imported source" } }, "New source");
        const sourceChangeStart = performance.now();
        const sourceMessagesStart = compiler.messages.length;
        f.authority.editElsewhere("sources/new-source.md", { body: "Updated source" });
        await until(workspace, () => workspace!.getSnapshot().library.some((e) => e.key === "newsource"));
        const newSourceMs = performance.now() - sourceChangeStart;
        const newSourceTransfers = totals(f.transfers.splice(0));
        const sourceWorkerMessages = compiler.messages.slice(sourceMessagesStart);
        output.push({ run: run + 1, seedMs, homeListMs, homeBackgroundMs, readyMs, sourcesUsableMs, sourcesFirstSearchMs, commentsUsableMs, annotationIndexMs, sourceAnnotationsMs, annotationsUsableMs, previewInitializedMs, externalRefreshMs, newSourceMs, newSourceTransfers, commentTransfers, returnHomeMs, returnHomeTransfers, navigationTransfers, noteWorkerMessages, sourceWorkerMessages, homeTransfers, readyTransfers, workspaceTransfers, externalTransfers, computations, workerMessages: [...compiler.messages] });
      } finally { await workspace?.dispose(); f.backend.dispose(); f.authority.watch.close(); }
      // Same collection size, redistributed highlights: one book has 300, not six.
      // Only its no-body annotation discovery pages are 6x slower, exposing preview gating.
      const book = fixture(300, 6);
      let bookWorkspace: ManuscriptWorkspace | undefined;
      try {
        await book.backend.library();
        book.transfers.length = 0;
        compiler.initAt = 0;
        const start = performance.now();
        bookWorkspace = new ManuscriptWorkspace(book.backend, main);
        await vi.waitFor(() => expect(compiler.initAt).toBeGreaterThan(start), { timeout: 120_000 });
        const slowAnnotationPreviewMs = compiler.initAt - start;
        await until(bookWorkspace, () => bookWorkspace!.getSnapshot().annotationsLoad.phase === "ready");
        const slowAnnotationIndexMs = performance.now() - start;
        book.transfers.length = 0;
        const readStart = performance.now();
        const highlights = await book.backend.annotationsForSource("sources/source00000.md");
        const annotations300Ms = performance.now() - readStart;
        expect(highlights.ok && highlights.value.length).toBe(300);
        Object.assign(output.at(-1)!, { slowAnnotationPreviewMs, slowAnnotationIndexMs, annotations300Ms, annotations300Transfers: totals(book.transfers) });
      } finally { await bookWorkspace?.dispose(); book.backend.dispose(); book.authority.watch.close(); }
    }
    const report = { environment: { node: process.version, cpu: cpus()[0]?.model, platform: process.platform }, counts, latencyMs, filePageSize, strictContracts, runs, results: output };
    const json = JSON.stringify(report, null, 2);
    const destination = process.env["PERF_OUTPUT"] ?? "out/perf/large-collection.json";
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, `${json}\n`);
    console.log(json);
  } finally { vi.unstubAllGlobals(); }
});
