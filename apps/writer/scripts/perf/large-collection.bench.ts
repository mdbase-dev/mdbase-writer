// Run from apps/writer: pnpm exec vitest run --config scripts/perf/vitest.config.ts
// No LAB, accounts or network. Real NativeWriterBackend/workspace/SDK sessions
// over MemoryReplica. Timings are Node proxies, NOT browser paint times.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { createTestApp } from "@mdbase-dev/sdk/testing";
import type { JsonObject } from "@mdbase-dev/sdk";
import manifest from "../../src/generated/mdbase-app.json";
import { demoContracts, demoRecord } from "../../src/backend/demo-fixture.js";
import { NativeWriterBackend } from "../../src/backend/native.js";
import { PathIndex, resolveLinkTarget } from "@mdbase-writer/core/records";
import { commentFromRecord, commentThreads } from "@mdbase-dev/ui/comments";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { authorYear, searchLibrary } from "../../src/editor/library-search.js";
import { writerCompletions } from "../../src/editor/completions.js";
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { placeThreads, ThreadPlacement } from "../../src/ui/comments.js";
import { CommentsPanel } from "@mdbase-dev/ui/comments-panel";
import { SourcesPanel } from "../../src/ui/SourcesPanel.js";
import { AppI18nProvider } from "../../src/i18n/provider.js";
import { ManuscriptWorkspace } from "../../src/workspace/workspace.js";
import { labelTargets, referenceKeys } from "../../src/editor/insight.js";
import { wordCount } from "../../src/words.js";

const compiler = vi.hoisted(() => ({ initAt: 0, messages: [] as { type: string; bytes: number; cloneMs: number }[] }));
vi.mock("../../src/compile/client.js", () => { class CompileClient {
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
} return { CompileClient, takeCompileClient: () => new CompileClient() }; });
vi.mock("../../src/export/pandoc.js", () => ({ toDocx: vi.fn() }));

import { counts, generateCollection, main } from "./generator.js";
const latencyMs = Number(process.env["PERF_LATENCY_MS"] ?? 20);
const runs = Number(process.env["PERF_RUNS"] ?? 3);
const filePageSize = Number(process.env["PERF_FILE_PAGE_SIZE"] ?? 500);
for (const [name, value] of Object.entries({ latencyMs, runs, filePageSize })) {
  if (!Number.isFinite(value) || value < (name === "latencyMs" ? 0 : 1)) throw new Error(`Invalid ${name}`);
}
const delay = () => latencyMs ? new Promise<void>((resolve) => setTimeout(resolve, latencyMs)) : Promise.resolve();
const pad = (n: number) => String(n).padStart(5, "0");
type Transfer = { operation: string; records: number; bodyBytes: number; jsonBytes: number };

async function fixture(highlightsPerBook?: number, annotationLatencyFactor = 1) {
  const rows: ReturnType<typeof demoRecord>[] = [];
  const body = generateCollection((path, type, frontmatter, text) => rows.push(demoRecord(path, { type, ...frontmatter }, text)), highlightsPerBook);
  const app = await createTestApp({
    declaration: { id: "writer.perf", name: "Writer benchmark", origin: "https://lab.mdbase-writer.pages.dev", environment: "lab", manifest },
    collections: [{ name: "Synthetic benchmark", records: rows, contracts: demoContracts }],
  });
  const replica = app.replica(), client = app.client();
  // Actual SDK file operations on the in-memory replica, outside measured startup.
  for (let i = 0; i < counts.files; i++) {
    const write = await client.files.upload(`files/image-${pad(i)}.png`, new Uint8Array([0]));
    await write.confirmed;
  }
  const transfers: Transfer[] = [];
  const account = (operation: string, data: unknown, records = 0, bodyBytes = 0) => {
    transfers.push({ operation, records, bodyBytes, jsonBytes: Buffer.byteLength(JSON.stringify(data)) });
    return data;
  };
  const describe = client.describe.bind(client);
  client.describe = async (...args) => { await delay(); const result = await describe(...args); account("describe", result); return result; };
  const pages = client.pages.bind(client);
  client.pages = async function* (...args) {
    for await (const page of pages(...args)) { await delay(); account("query:all-records", page, page.records.length); yield page; }
  };
  const queryContract = client.queryContract.bind(client);
  client.queryContract = async (...args) => {
    const type = demoContracts.find(contract => contract.id === args[0].id)?.type;
    for (let i = 0; i < (type === "reader-annotation" ? annotationLatencyFactor : 1); i++) await delay();
    const page = await queryContract(...args); account(`query:${type}`, page, page.records.length); return page;
  };
  const get = client.get.bind(client);
  client.get = async (...args) => {
    await delay(); const record = await get(...args);
    account(`read:${record.types[0] ?? "note"}`, record, 1, Buffer.byteLength(record.body ?? "")); return record;
  };
  const listPage = client.files.listPage.bind(client.files);
  client.files.listPage = async options => {
    await delay(); const page = await listPage({ ...options, limit: Math.min(options?.limit ?? filePageSize, filePageSize) });
    account("files:list", page, page.files.length); return page;
  };
  const connection = app.mdbase.connection(client.collection);
  if (!connection) throw new Error("Missing benchmark SDK connection");
  const lifetime = new AbortController();
  const backend = new NativeWriterBackend(connection, { collectionName: connection.displayName, signal: lifetime.signal });
  const seed = (path: string, type: string, frontmatter: JsonObject, text: string) => replica.seed(demoRecord(path, { type, ...frontmatter }, text));
  return { replica, backend, rows, transfers, body, seed, close: async () => { backend.dispose(); lifetime.abort(); await app.close(); } };
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
      const f = await fixture();
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
        const commentTransfers = totals(f.transfers.filter((e) => e.operation === "query:comment" || e.operation === "read:comment" || e.operation === "query:comment:selection"));
        const annotationIdentityTransfers = totals(f.transfers.filter((e) => e.operation === "query:reader-annotation" && !e.bodyBytes));
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
          sourcePanelSSR: measure(() => renderToString(createElement(AppI18nProvider, null, createElement(SourcesPanel, { query: "", setQuery: noop, library, cited, loadAnnotations: () => Promise.resolve(annotations), onInsert: noop, onStepCitation: noop, canInsert: true }))), 3),
          commentsPanelSSR: measure(() => renderToString(createElement(AppI18nProvider, null, createElement(CommentsPanel, { threads: placed, people: snap.people, active: null, pending: null, recordTitle: (p) => p, onSelect: noop, onSubmit: ok, onCancel: noop, onReply: ok, onChange: ok, onAccept: ok, onStart: noop }))), 3),
          annotationFilter6: measure(() => annotations.ok ? annotations.value.filter((a) => a.source === library[0]!.path || library[0]!.path.endsWith(`/${a.source}`)) : []),
          cloneLibrary5000: measure(() => structuredClone({ type: "library", library: library.map((e) => e.item) })),
        };
        const previousRecords = workspace.getSnapshot().recordPaths;
        const refreshMessagesStart = compiler.messages.length;
        const refreshStart = performance.now();
        f.replica.editElsewhere("notes/note-00000.md", { body: "Changed in another app" });
        await until(workspace, () => {
          const current = workspace!.getSnapshot();
          return current.indexLoad.phase === "ready" && current.libraryLoad.phase === "ready" && current.annotationsLoad.phase === "ready" && (current.recordPaths !== previousRecords || f.transfers.some((t) => t.operation === "query:changed-paths" || t.operation === "read:note"));
        });
        const externalRefreshMs = performance.now() - refreshStart;
        const externalTransfers = totals(f.transfers.splice(0));
        const noteWorkerMessages = compiler.messages.slice(refreshMessagesStart);
        f.seed("sources/new-source.md", "reader-source", { csl: { id: "newsource", type: "book", title: "A newly imported source" } }, "New source");
        const sourceChangeStart = performance.now();
        const sourceMessagesStart = compiler.messages.length;
        f.replica.editElsewhere("sources/new-source.md", { body: "Updated source" });
        await until(workspace, () => workspace!.getSnapshot().library.some((e) => e.key === "newsource"));
        const newSourceMs = performance.now() - sourceChangeStart;
        const newSourceTransfers = totals(f.transfers.splice(0));
        const sourceWorkerMessages = compiler.messages.slice(sourceMessagesStart);
        output.push({ run: run + 1, seedMs, homeListMs, homeBackgroundMs, readyMs, sourcesUsableMs, sourcesFirstSearchMs, commentsUsableMs, annotationIndexMs, sourceAnnotationsMs, annotationsUsableMs, previewInitializedMs, externalRefreshMs, newSourceMs, newSourceTransfers, commentTransfers, annotationIdentityTransfers, returnHomeMs, returnHomeTransfers, navigationTransfers, noteWorkerMessages, sourceWorkerMessages, homeTransfers, readyTransfers, workspaceTransfers, externalTransfers, computations, workerMessages: [...compiler.messages] });
      } finally { await workspace?.dispose(); await f.close(); }
      // Same collection size, redistributed highlights: one book has 300, not six.
      // Only its no-body annotation discovery pages are 6x slower, exposing preview gating.
      const book = await fixture(300, 6);
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
      } finally { await bookWorkspace?.dispose(); await book.close(); }
    }
    const report = { environment: { node: process.version, cpu: cpus()[0]?.model, platform: process.platform }, counts, latencyMs, filePageSize, runs, results: output };
    const json = JSON.stringify(report, null, 2);
    const destination = process.env["PERF_OUTPUT"] ?? "out/perf/large-collection.json";
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, `${json}\n`);
    console.log(json);
  } finally { vi.unstubAllGlobals(); }
});
