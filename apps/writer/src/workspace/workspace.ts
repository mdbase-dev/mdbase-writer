// One open manuscript: its record sessions, the compile worker, and a single
// snapshot the UI renders from.
//
// The manuscript and each record it embeds get their own record session
// (autosave, conflict detection, exact recovery — all from the SDK). Every
// content change is forwarded to the worker, which assembles and typesets
// the whole manuscript and reports which embedded records it still needs.
import type { JsonObject, MdbaseRecordLease, MdbaseRecordSessionSnapshot, RecordDocument } from "@mdbase-dev/connect";
import { ManuscriptAssembler, translateRecord, type WriterRecord, type AssemblyInput } from "@mdbase-writer/core";
import { applySuggestion, bodyHash, linkPath, targetFor, type CommentRecord, type CommentThread } from "@mdbase-writer/core/comments";
import { BUNDLE_README, materialize } from "@mdbase-writer/core/materialize";
import { isAnnotation } from "@mdbase-writer/core/annotations";
import { IMAGE_EXTENSION, PathIndex, pathIndex, resolveLinkTarget } from "@mdbase-writer/core/records";
import { LOCALES, STYLES } from "@mdbase-writer/core/styles";

import { NO_PEOPLE, type CommentChange, type People } from "../backend/comments.js";
import { fail, manuscriptSlug, manuscriptFrontmatter, ok, type ManuscriptBinding, type LibraryEntry, type CollectionDelta, type Result, type WriterBackend } from "../backend/types.js";
import { toLocal } from "../backend/comments.js";
import { errorMessage, fetchChecked, mapConcurrent } from "../async.js";
import { DraftStore, draftPatch, type LocalDraft } from "./drafts.js";
import { CompileClient } from "../compile/client.js";
import type { CompileResult, WriterDiagnostic } from "../compile/protocol.js";
import { toDocx } from "../export/pandoc.js";
import { zip } from "../export/zip.js";
import { appendEmbed, chapterEmbeds, moveEmbed } from "./chapters.js";

// Styles and locales are fetched, not bundled: only the worker needs most of them.
const cslUrls = import.meta.glob("../../../../packages/core/assets/csl/*.{csl,xml}", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const cslUrl = (file: string) => cslUrls[`../../../../packages/core/assets/csl/${file}`] ?? "";
let stylesPromise: Promise<{ styles: Map<string, string>; locales: Map<string, string> }> | undefined;
function loadStyles() {
  stylesPromise ??= (async () => {
    const text = (url: string) => fetchChecked(url).then((r) => r.text());
    const [styles, locales] = await Promise.all([
      Promise.all(STYLES.map((s) => text(cslUrl(`${s.id}.csl`)))),
      Promise.all(LOCALES.map((l) => text(cslUrl(`locales-${l}.xml`)))),
    ]);
    return {
      styles: new Map(STYLES.map((s, i) => [s.id, styles[i] ?? ""])),
      locales: new Map(LOCALES.map((l, i) => [l, locales[i] ?? ""])),
    };
  })().catch((error: unknown) => { stylesPromise = undefined; throw error; });
  return stylesPromise;
}

/** Source record path → citekey. */
const librarySourceKeys = new WeakMap<readonly LibraryEntry[], ReadonlyMap<string, string>>();
export function sourceKeys(library: readonly LibraryEntry[]): ReadonlyMap<string, string> {
  let keys = librarySourceKeys.get(library);
  if (!keys) { keys = new Map(library.map((e) => [e.path, e.key])); librarySourceKeys.set(library, keys); }
  return keys;
}

export type SessionSnapshot = MdbaseRecordSessionSnapshot<RecordDocument<JsonObject>>;

export interface RecordView {
  readonly path: string;
  readonly snapshot: SessionSnapshot;
}

export type LoadState = { readonly phase: "loading" | "ready" | "failed"; readonly problem?: string };
const LOADING: LoadState = { phase: "loading" };
const READY: LoadState = { phase: "ready" };
type MetadataDomain = "indexLoad" | "libraryLoad" | "annotationsLoad";

export interface WorkspaceSnapshot {
  readonly main: string;
  readonly phase: "loading" | "ready" | "failed";
  readonly indexLoad: LoadState;
  readonly libraryLoad: LoadState;
  readonly annotationsLoad: LoadState;
  readonly commentsLoad: LoadState;
  readonly problem?: string | undefined;
  readonly previewProblem?: string | undefined;
  readonly draftProblem?: string | undefined;
  readonly recoveredDrafts: ReadonlyMap<string, LocalDraft>;
  readonly assetProblems: ReadonlyMap<string, string>;
  readonly recordProblems: ReadonlyMap<string, string>;
  readonly records: ReadonlyMap<string, RecordView>;
  readonly result?: CompileResult;
  /** The latest artifact that compiled (kept while later edits have errors). */
  readonly artifact?: Uint8Array;
  readonly artifactRevision?: number;
  readonly library: readonly LibraryEntry[];
  readonly recordPaths: readonly string[];
  readonly filePaths: readonly string[];
  readonly recordIndex: PathIndex;
  readonly fileIndex: PathIndex;
  /** Records the collection lists as Reader annotations (an embedded one is a quotation). */
  readonly annotationPaths: ReadonlySet<string>;
  readonly annotationVersion: number;
  /** Increases as images and other files load, so views drawing them redraw. */
  readonly assetVersion: number;
  readonly compiling: boolean;
  readonly pendingSettings: boolean;
  /** Every comment in the collection; the UI keeps those on this manuscript's records. */
  readonly comments: readonly CommentRecord[];
  /** Why comments could not be loaded (a collection not set up for them, say). */
  readonly commentsProblem?: string | undefined;
  readonly people: People;
}

export function discoveredDiagnostics(diagnostics: readonly WriterDiagnostic[], snapshot: Pick<WorkspaceSnapshot, "indexLoad" | "libraryLoad" | "annotationsLoad">): readonly WriterDiagnostic[] {
  return diagnostics.filter((d) => !d.metadata || snapshot[`${d.metadata}Load`].phase === "ready");
}

/** A passage chosen to comment on: the body it was chosen in and its UTF-16 range. */
export interface CommentDraft {
  readonly record: string;
  readonly body: string;
  readonly from: number;
  readonly to: number;
}

export class ManuscriptWorkspace {
  private compile = new CompileClient();
  private previewInitialized = false;
  private compileCleanups: (() => void)[] = [];
  private bindings: readonly ManuscriptBinding[] = [];
  private readonly drafts: DraftStore;
  private readonly stagedSettings = new Map<string, JsonObject>();
  private readonly assetBytes = new Map<string, Uint8Array>();
  /** Object URLs of images shown in the editor, revoked when the manuscript closes. */
  private readonly imageUrls = new Map<string, string>();
  private readonly assetJobs = new Map<string, Promise<void>>();
  private readonly assetAttempts = new Map<string, number>();
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();
  private readonly leases = new Map<string, { lease: MdbaseRecordLease<JsonObject>; unsubscribe: () => void }>();
  private readonly opening = new Map<string, Promise<boolean>>();
  private readonly sent = new Map<string, string>();
  private readonly translations = new Map<string, { body: string; translated: ReturnType<typeof translateRecord> }>();
  private lastOrder: readonly string[] = [];
  private readonly requestedAssets = new Set<string>();
  /** Collection text files loaded for the settings (a .csl style, a .typ template). */
  private readonly texts = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: (() => void)[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private commentsTimer: ReturnType<typeof setTimeout> | undefined;
  private current: WorkspaceSnapshot;
  private workerLibrary = new Map<string, LibraryEntry["item"]>();
  private workerRecordPaths: ReadonlySet<string> = new Set();
  private workerFilePaths: ReadonlySet<string> = new Set();
  private workerAnnotationPaths: ReadonlySet<string> = new Set();
  private workerSourceKeys: ReadonlyMap<string, string> = new Map();
  private commentsScope = "";
  private metadataJobs: Partial<Record<MetadataDomain, Promise<void>>> = {};
  private metadataGeneration = 0;
  private commentsGeneration = 0;
  private annotationGeneration = 0;
  private disposed = false;

  constructor(
    private readonly backend: WriterBackend,
    readonly main: string,
  ) {
    this.drafts = new DraftStore(backend.draftNamespace ?? `${backend.kind}:${backend.collectionName}`);
    this.current = { main, phase: "loading", indexLoad: LOADING, libraryLoad: LOADING, annotationsLoad: LOADING, commentsLoad: LOADING, records: new Map(), library: [], recordPaths: [], filePaths: [], recordIndex: new PathIndex([]), fileIndex: new PathIndex([]), annotationPaths: new Set(), annotationVersion: 0, assetVersion: 0, compiling: true, pendingSettings: false, comments: [], people: NO_PEOPLE, recoveredDrafts: new Map(), assetProblems: new Map(), recordProblems: new Map() };
    this.followCompiler();
    this.cleanups.push(backend.onExternalChange((paths) => this.onExternalChange(paths)));
    if (backend.onCollectionChange) this.cleanups.push(backend.onCollectionChange((delta) => this.onCollectionChange(delta)));
    // Linking a person record happens in another tab (mdbase Editor): look again on return.
    if (typeof window !== "undefined") {
      const onFocus = () => {
        if (this.current.people.signing?.kind === "linked" || Date.now() - this.peopleCheckedAt < 5_000) return;
        void this.refreshPeople();
      };
      const onUnload = (event: BeforeUnloadEvent) => {
        if (!this.hasUnsavedChanges()) return;
        event.preventDefault();
        event.returnValue = "";
      };
      const onOnline = () => { void this.retrySave(); void this.retryAssets(); };
      window.addEventListener("focus", onFocus);
      window.addEventListener("beforeunload", onUnload);
      window.addEventListener("online", onOnline);
      this.cleanups.push(() => {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("beforeunload", onUnload);
        window.removeEventListener("online", onOnline);
      });
    }
    void this.start();
  }

  /** Whether this is a real collection or the demo. */
  get setupStatus() { return this.backend.setupStatus; }

  get kind(): WriterBackend["kind"] {
    return this.backend.kind;
  }

  getSnapshot = (): WorkspaceSnapshot => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<WorkspaceSnapshot>): void {
    if (this.disposed) return;
    if (patch.recordPaths) patch = { ...patch, recordIndex: pathIndex(patch.recordPaths) };
    if (patch.filePaths) patch = { ...patch, fileIndex: pathIndex(patch.filePaths) };
    this.current = { ...this.current, ...patch };
    for (const l of this.listeners) l();
  }

  private followCompiler(): void {
    this.compileCleanups = [
      this.compile.onResult((result) => this.onResult(result)),
      this.compile.onFailure((message) => this.update({ previewProblem: message, compiling: false })),
    ];
  }

  private async start(): Promise<void> {
    if (!this.leases.has(this.main)) {
      const recovered = this.drafts.read(this.main);
      if (recovered) this.update({ recoveredDrafts: new Map(this.current.recoveredDrafts).set(this.main, recovered) });
    }
    try {
      this.loadMetadata();
      const bindings = await this.backend.manuscriptBindings?.();
      if (bindings && !bindings.ok) throw new Error(bindings.message);
      if (this.disposed) return;
      this.bindings = bindings?.ok ? bindings.value : [];
      const opened = await this.open(this.main);
      this.update({ phase: opened ? "ready" : "failed", compiling: opened });
      if (!opened) return;
      // Fonts/styles/renderer availability must not prevent writing or saving.
      void this.initializePreview();
      void this.loadComments();
    } catch (error) {
      this.update({ phase: "failed", problem: errorMessage(error), compiling: false });
    }
  }

  async retryOpen(): Promise<void> {
    this.update({ phase: "loading", problem: undefined });
    await this.start();
  }

  private loadMetadata(fresh = false): void {
    if (!fresh && Object.keys(this.metadataJobs).length) return;
    const generation = ++this.metadataGeneration;
    const jobs: Record<MetadataDomain, () => Promise<void>> = {
      indexLoad: () => this.loadIndex(generation),
      libraryLoad: () => this.loadLibrary(generation),
      annotationsLoad: () => this.loadAnnotationPaths(generation),
    };
    for (const domain of Object.keys(jobs) as MetadataDomain[]) {
      if (!fresh && this.metadataJobs[domain]) continue;
      this.update({ [domain]: LOADING });
      // A superseded load must not overwrite a newer snapshot.
      const job = jobs[domain]();
      this.metadataJobs[domain] = job;
    }
  }

  private async loadIndex(generation: number): Promise<void> {
    try {
      const index = await this.backend.index();
      if (generation !== this.metadataGeneration || this.disposed) return;
      if (!index.ok) throw new Error(index.message);
      this.update({ ...(index.value.recordPaths !== this.current.recordPaths ? { recordPaths: index.value.recordPaths } : {}), ...(index.value.filePaths !== this.current.filePaths ? { filePaths: index.value.filePaths } : {}), indexLoad: READY });
      this.sendCollection();
      for (const [path, view] of this.current.records) this.openEmbeds(path, view.snapshot.body);
    } catch (error) { if (generation === this.metadataGeneration) this.update({ indexLoad: { phase: "failed", problem: errorMessage(error) } }); }
  }

  private async loadLibrary(generation: number): Promise<void> {
    try {
      const library = await this.backend.library();
      if (generation !== this.metadataGeneration || this.disposed) return;
      if (!library.ok) throw new Error(library.message);
      this.update({ library: library.value, libraryLoad: READY });
      this.sendLibrary();
      this.sendQuotations();
    } catch (error) { if (generation === this.metadataGeneration) this.update({ libraryLoad: { phase: "failed", problem: errorMessage(error) } }); }
  }

  private async metadata(annotations = true, index = true): Promise<void> {
    this.loadMetadata();
    for (;;) {
      const generation = this.metadataGeneration;
      await Promise.all(annotations ? Object.values(this.metadataJobs) : [index ? this.metadataJobs.indexLoad : undefined, this.metadataJobs.libraryLoad]);
      if (this.disposed || generation === this.metadataGeneration) break;
    }
    if (this.disposed) throw new Error("The manuscript was closed.");
    // Annotation discovery is optional: a real failure is visible, not a preview/export gate.
    for (const domain of (index ? ["indexLoad", "libraryLoad"] : ["libraryLoad"]) as MetadataDomain[]) {
      const state = this.current[domain];
      if (state.phase !== "ready") throw new Error(state.problem ?? "Collection metadata is still loading.");
    }
  }

  async retryMetadata(): Promise<void> {
    await this.backend.reconcile?.();
    this.loadMetadata(true);
    await this.metadata();
    if (this.current.previewProblem) await this.retryPreview();
  }

  private async initializePreview(): Promise<void> {
    const client = this.compile;
    try {
      // Compiler assets and CSL can load while the collection is enumerated.
      client.send({ type: "prepare", baseUrl: import.meta.env.BASE_URL });
      const styles = loadStyles();
      // Handle an early fetch failure even while metadata is still pending.
      void styles.catch(() => {});
      await this.metadata(false, false);
      const csl = await styles;
      // A self-contained manuscript needs CSL, not every collection path. Never
      // resolve an embed/image/custom asset against a partial basename index.
      // Recheck after the awaits: the user may have added a dependency meanwhile.
      const record = this.current.records.get(this.main)?.snapshot;
      const translated = record && this.translated(this.main, record.body);
      const template = record?.frontmatter["template"], style = record?.frontmatter["csl"];
      if (!translated || translated.includes.length || translated.images.length
        || template !== undefined && template !== "article" && template !== "thesis"
        || style !== undefined && !STYLES.some((s) => s.id === style)) await this.metadata(false);
      // Annotation identities follow through sendQuotations; diagnostics remain gated.
      if (this.disposed || client !== this.compile) return;
      client.send({ type: "init", library: this.current.library.map((e) => e.item), styles: [...csl.styles], locales: [...csl.locales], baseUrl: import.meta.env.BASE_URL });
      this.previewInitialized = true;
      this.workerLibrary = new Map(this.current.library.map((e) => [e.key, e.item]));
      this.workerRecordPaths = this.current.recordIndex;
      this.workerFilePaths = this.current.fileIndex;
      this.workerAnnotationPaths = new Set(); this.workerSourceKeys = new Map();
      client.send({ type: "collection", recordPaths: this.current.recordPaths, filePaths: this.current.filePaths });
      client.send({ type: "main", path: this.main });
      client.send({ type: "records", upsert: this.writerRecords() });
      this.sendQuotations();
      this.sendAssets([...this.assetBytes]);
    } catch (error) {
      if (client === this.compile) this.update({ previewProblem: errorMessage(error), compiling: false });
    }
  }

  async retryPreview(): Promise<void> {
    for (const cleanup of this.compileCleanups) cleanup();
    this.compile.terminate();
    this.compile = new CompileClient();
    this.previewInitialized = false;
    this.followCompiler();
    this.update({ previewProblem: undefined, compiling: true });
    await this.initializePreview();
    await this.retryAssets();
  }

  private fieldsFor(types: readonly string[]): Readonly<Record<string, string>> {
    return this.bindings.find((binding) => types.includes(binding.name))?.fields ?? {};
  }

  canonicalFields(frontmatter: JsonObject, types: readonly string[]): JsonObject {
    return manuscriptFrontmatter(frontmatter, this.fieldsFor(types));
  }

  private writerRecords(): WriterRecord[] {
    return [...this.current.records].filter(([, view]) => view.snapshot.state !== "deleted").map(([path, view]) => ({ path, body: view.snapshot.body, frontmatter: view.snapshot.frontmatter }));
  }

  private peopleCheckedAt = 0;

  /** Checks the account against the collection's person records again. */
  async refreshPeople(): Promise<void> {
    this.peopleCheckedAt = Date.now();
    this.update({ people: await this.backend.people({ fresh: true }) });
  }

  /** Asks Connect to approve Writer again (to allow the identity permission), then checks the account. */
  async reviewIdentityAccess(): Promise<Result<void>> {
    if (!this.backend.reviewIdentityAccess) return fail("Writer cannot ask for access here.");
    const reviewed = await this.backend.reviewIdentityAccess();
    if (reviewed.ok) await this.refreshPeople();
    return reviewed;
  }

  /** Learns which records are annotations, and tells the worker how to cite them. */
  private async loadAnnotationPaths(generation: number): Promise<void> {
    const annotationGeneration = ++this.annotationGeneration;
    try {
      const annotations = await this.backend.annotationPaths();
      if (this.disposed || generation !== this.metadataGeneration || annotationGeneration !== this.annotationGeneration) return;
      if (!annotations.ok) throw new Error(annotations.message);
      const paths = new Set(annotations.value);
      const changed = paths.size !== this.current.annotationPaths.size || [...paths].some((p) => !this.current.annotationPaths.has(p));
      this.update({ annotationPaths: paths, annotationVersion: this.current.annotationVersion + Number(changed), annotationsLoad: READY });
      // Custom annotation sessions need the same canonical fields as per-source reads.
      for (const [path, { lease }] of this.leases) this.onSession(path, lease.session.getSnapshot());
      this.sendQuotations();
    } catch (error) {
      if (generation !== this.metadataGeneration || annotationGeneration !== this.annotationGeneration) return;
      this.update({ annotationsLoad: { phase: "failed", problem: errorMessage(error) } });
    }
  }

  private sendCollection(): void {
    if (!this.previewInitialized) return;
    const records = this.current.recordIndex, files = this.current.fileIndex;
    const recordUpsert = [...records].filter((p) => !this.workerRecordPaths.has(p)), recordRemove = [...this.workerRecordPaths].filter((p) => !records.has(p));
    const fileUpsert = [...files].filter((p) => !this.workerFilePaths.has(p)), fileRemove = [...this.workerFilePaths].filter((p) => !files.has(p));
    if (recordUpsert.length || recordRemove.length || fileUpsert.length || fileRemove.length) this.compile.send({ type: "collection-delta", recordUpsert, recordRemove, fileUpsert, fileRemove });
    this.workerRecordPaths = records; this.workerFilePaths = files;
  }

  private sendLibrary(): void {
    if (!this.previewInitialized) return;
    const library = new Map(this.current.library.map((e) => [e.key, e.item]));
    const upsert = [...library].filter(([key, item]) => this.workerLibrary.get(key) !== item && JSON.stringify(this.workerLibrary.get(key)) !== JSON.stringify(item)).map(([, item]) => item);
    const remove = [...this.workerLibrary.keys()].filter((key) => !library.has(key));
    if (upsert.length || remove.length) this.compile.send({ type: "library-delta", upsert, remove });
    this.workerLibrary = library;
  }

  private sendQuotations(): void {
    if (!this.previewInitialized) return;
    const annotations = this.current.annotationPaths, keys = sourceKeys(this.current.library);
    const annotationUpsert = [...annotations].filter((p) => !this.workerAnnotationPaths.has(p)), annotationRemove = [...this.workerAnnotationPaths].filter((p) => !annotations.has(p));
    const sourceUpsert = [...keys].filter(([path, key]) => this.workerSourceKeys.get(path) !== key), sourceRemove = [...this.workerSourceKeys.keys()].filter((p) => !keys.has(p));
    if (annotationUpsert.length || annotationRemove.length || sourceUpsert.length || sourceRemove.length) this.compile.send({ type: "quotations-delta", annotationUpsert, annotationRemove, sourceUpsert, sourceRemove });
    this.workerAnnotationPaths = annotations; this.workerSourceKeys = keys;
  }

  async loadComments(): Promise<void> {
    const generation = ++this.commentsGeneration;
    const scope = this.readingOrder();
    this.commentsScope = scope.join("\u0000");
    this.update({ commentsLoad: LOADING });
    this.peopleCheckedAt = Date.now();
    try {
      const [comments, people] = await Promise.all([this.backend.comments(scope), this.backend.people()]);
      if (this.disposed || generation !== this.commentsGeneration) return;
      this.update(comments.ok ? { comments: comments.value, commentsProblem: undefined, commentsLoad: READY, people } : { commentsProblem: comments.message, commentsLoad: { phase: "failed", problem: comments.message }, people });
    } catch (error) { if (generation === this.commentsGeneration) this.update({ commentsProblem: errorMessage(error), commentsLoad: { phase: "failed", problem: errorMessage(error) } }); }
  }

  /** Opens (once) and follows the session for a record. */
  private open(path: string): Promise<boolean> {
    if (this.leases.has(path)) return Promise.resolve(true);
    const existing = this.opening.get(path);
    if (existing) return existing;
    const job = this.openRecord(path).finally(() => this.opening.delete(path));
    this.opening.set(path, job);
    return job;
  }

  private async openRecord(path: string): Promise<boolean> {
    const recovered = this.drafts.read(path);
    if (recovered) this.update({ recoveredDrafts: new Map(this.current.recoveredDrafts).set(path, recovered) });
    try {
      const opened = await this.backend.records.open(path, { autosave: { idleMs: 1_000 }, timeoutMs: 15_000 });
      if (!opened.ok) throw new Error(opened.problem.message ?? opened.problem.code);
      if (this.disposed) { opened.value.release(); return false; }
      const { session } = opened.value;
      if (recovered) {
        const saved = session.getSnapshot();
        if (saved.body === recovered.body && JSON.stringify(saved.frontmatter) === JSON.stringify(recovered.frontmatter)) this.discardDraft(path);
      }
      const unsubscribe = session.subscribe(() => this.onSession(path, session.getSnapshot()));
      this.leases.set(path, { lease: opened.value, unsubscribe });
      const recordProblems = new Map(this.current.recordProblems);
      recordProblems.delete(path);
      this.update({ recordProblems });
      this.onSession(path, session.getSnapshot());
      return true;
    } catch (error) {
      const message = errorMessage(error);
      this.update({ recordProblems: new Map(this.current.recordProblems).set(path, message), ...(path === this.main ? { problem: message } : {}) });
      return false;
    }
  }

  async retryRecords(): Promise<void> {
    await mapConcurrent([...this.current.recordProblems.keys()], 4, (path) => this.open(path));
  }

  private annotationFields(path: string, raw: SessionSnapshot): Readonly<Record<string, string>> {
    const type = raw.frontmatter["type"];
    return this.backend.annotationFields?.(path, [...raw.record.types, ...(typeof type === "string" ? [type] : [])]) ?? {};
  }

  private onSession(path: string, raw: SessionSnapshot): void {
    if (this.disposed) return;
    this.persistDraft(path, raw);
    const annotationFields = this.annotationFields(path, raw);
    const annotation = raw.state !== "deleted" && annotationFields["source"] && !this.current.annotationPaths.has(path) ? { annotationPaths: new Set([...this.current.annotationPaths, path]) } : {};
    const snapshot = { ...raw, frontmatter: manuscriptFrontmatter(raw.frontmatter, { ...annotationFields, ...this.fieldsFor(raw.record.types) }) };
    const records = new Map(this.current.records);
    records.set(path, { path, snapshot });
    // Forward only content changes; save-state transitions don't need a compile.
    const key = `${snapshot.body}\u0000${JSON.stringify(snapshot.frontmatter)}\u0000${snapshot.state === "deleted"}`;
    if (this.sent.get(path) === key) {
      this.update({ records, ...annotation });
      if (annotation.annotationPaths) this.sendQuotations();
      return;
    }
    this.sent.set(path, key);
    // One update per edit: each re-renders the whole workspace.
    this.update({ records, ...annotation, compiling: !this.current.previewProblem });
    if (this.previewInitialized) this.compile.send(snapshot.state === "deleted" ? { type: "records", upsert: [], remove: [path] } : { type: "records", upsert: [{ path, body: snapshot.body, frontmatter: snapshot.frontmatter }] });
    if (annotation.annotationPaths) this.sendQuotations();
    // Opening chapters must not depend on a healthy compiler or renderer.
    this.openEmbeds(path, snapshot.body);
    if (this.current.phase === "ready" && this.commentsScope !== this.readingOrder().join("\u0000")) {
      clearTimeout(this.commentsTimer);
      this.commentsTimer = setTimeout(() => void this.loadComments(), 50);
    }
  }

  private openEmbeds(path: string, body: string): void {
    const candidates = this.current.recordIndex;
    for (const embed of this.translated(path, body).includes) {
      const target = resolveLinkTarget(embed.target, path, candidates);
      if (target && !this.current.recordProblems.has(target)) void this.open(target);
    }
  }

  private translated(path: string, body: string) {
    const known = this.translations.get(path);
    if (known?.body === body) return known.translated;
    const translated = translateRecord(body);
    this.translations.set(path, { body, translated });
    return translated;
  }

  readingOrder(): readonly string[] {
    const order: string[] = [];
    const seen = new Set<string>();
    const candidates = this.current.recordIndex;
    const visit = (path: string) => {
      if (seen.has(path)) return;
      seen.add(path);
      const view = this.current.records.get(path);
      if (path !== this.main && this.isQuotation(path)) return;
      order.push(path);
      if (!view) return;
      for (const embed of this.translated(path, view.snapshot.body).includes) {
        const target = resolveLinkTarget(embed.target, path, candidates);
        if (target) visit(target);
      }
    };
    visit(this.main);
    if (order.length !== this.lastOrder.length || order.some((path, index) => path !== this.lastOrder[index])) this.lastOrder = order;
    return this.lastOrder;
  }

  private persistDraft(path: string, raw: SessionSnapshot): void {
    if (this.current.recoveredDrafts.has(path)) return;
    const staged = this.stagedSettings.get(path);
    if (staged || raw.dirty || raw.state === "conflict" || raw.state === "error" || raw.state === "deleted" && raw.body !== raw.record.body) {
      const stored = this.drafts.write(path, { version: 1, body: raw.body, frontmatter: { ...raw.frontmatter, ...staged }, baseBody: raw.record.body ?? "", baseFrontmatter: raw.record.frontmatter, revision: raw.record.revision, updated: new Date().toISOString() });
      if (!stored) this.update({ draftProblem: "Local draft backup is unavailable (browser storage may be full or blocked). Download your draft before leaving if saving fails." });
    } else this.drafts.remove(path);
  }

  private onResult(result: CompileResult): void {
    this.update({ result, compiling: false, ...(result.artifact ? { artifact: result.artifact, artifactRevision: result.revision } : {}) });
    for (const path of result.unloaded) if (!this.current.recordProblems.has(path)) void this.open(path);
    const wanted = result.neededAssets.filter((a) => !this.requestedAssets.has(a));
    if (wanted.length) void this.loadAssets(wanted);
  }

  private sendAssets(files: readonly [string, Uint8Array][]): void {
    // Initialization sends the latest snapshots; don't start a compiler timeout while discovery waits.
    if (!this.previewInitialized) return;
    // Retain original bytes for preview retries and frozen exports.
    const copies: [string, Uint8Array][] = files.map(([path, bytes]) => [path, bytes.slice()]);
    if (copies.length) this.compile.send({ type: "assets", files: copies }, copies.map(([, bytes]) => bytes.buffer));
  }

  private async loadAssets(paths: readonly string[]): Promise<void> {
    await mapConcurrent(paths, 4, (path) => {
      const existing = this.assetJobs.get(path);
      if (existing) return existing;
      this.requestedAssets.add(path);
      const job = this.loadAsset(path).finally(() => this.assetJobs.delete(path));
      this.assetJobs.set(path, job);
      return job;
    });
  }

  private async loadAsset(path: string): Promise<void> {
    const attempt = (this.assetAttempts.get(path) ?? 0) + 1;
    this.assetAttempts.set(path, attempt);
    try {
      const read = await this.backend.readFile(path);
      if (!read.ok) throw new Error(read.message);
      if (this.disposed) return;
      this.assetAttempts.delete(path);
      this.assetBytes.set(path, read.value);
      const shown = this.imageUrls.get(path);
      if (shown) { URL.revokeObjectURL(shown); this.imageUrls.delete(path); }
      if (/\.(csl|typ)$/i.test(path)) this.texts.set(path, new TextDecoder().decode(read.value));
      const assetProblems = new Map(this.current.assetProblems);
      assetProblems.delete(path);
      this.update({ assetProblems, assetVersion: this.current.assetVersion + 1 });
      this.sendAssets([[path, read.value]]);
    } catch (error) {
      if (this.disposed) return;
      this.update({ assetProblems: new Map(this.current.assetProblems).set(path, errorMessage(error)) });
      // Two bounded retries for transient failures; afterwards a visible Retry remains.
      if (attempt < 3) {
        const timer = setTimeout(() => {
          this.retryTimers.delete(timer);
          if (!this.disposed && this.current.assetProblems.has(path)) void this.loadAssets([path]);
        }, 500 * 2 ** (attempt - 1));
        this.retryTimers.add(timer);
      }
    }
  }

  async retryAssets(): Promise<void> {
    const paths = [...this.current.assetProblems.keys()];
    for (const path of paths) this.assetAttempts.delete(path);
    await this.loadAssets(paths);
  }

  /** Failures belong to the same Markdown ranges as the missing dependency. */
  dependencyDiagnostics(): WriterDiagnostic[] {
    const diagnostics: WriterDiagnostic[] = [];
    if (this.current.indexLoad.phase !== "ready") return diagnostics;
    const candidates = this.current.fileIndex;
    const recordPaths = this.current.recordIndex;
    for (const [path, view] of this.current.records) {
      const translated = this.translated(path, view.snapshot.body);
      for (const image of translated.images) {
        const asset = resolveLinkTarget(image.target, path, candidates, "");
        const problem = asset && this.current.assetProblems.get(asset);
        if (problem) diagnostics.push({ record: path, from: image.from, to: image.to, severity: "error" as const, origin: "writer" as const, message: `Image could not be loaded: ${problem}` });
      }
      for (const embed of translated.includes) {
        const target = resolveLinkTarget(embed.target, path, recordPaths);
        const problem = target && this.current.recordProblems.get(target);
        if (problem) diagnostics.push({ record: path, from: embed.from, to: embed.to, severity: "error" as const, origin: "writer" as const, message: `Embedded record could not be loaded: ${problem}` });
      }
    }
    return diagnostics;
  }

  private onCollectionChange(delta: CollectionDelta): void {
    if (delta.problem) { this.update({ indexLoad: { phase: "failed", problem: delta.problem } }); return; }
    if (delta.reset) { void this.refreshCollection(); return; }
    const indexChanged = delta.index && (delta.index.recordPaths !== this.current.recordPaths || delta.index.filePaths !== this.current.filePaths);
    this.update({ ...(delta.index ? { ...(indexChanged ? { recordPaths: delta.index.recordPaths, filePaths: delta.index.filePaths } : {}), indexLoad: READY } : {}), ...(delta.library ? { library: delta.library, libraryLoad: READY } : {}) });
    if (indexChanged) {
      this.sendCollection();
      for (const [path, view] of this.current.records) this.openEmbeds(path, view.snapshot.body);
    }
    if (delta.library) { this.sendLibrary(); this.sendQuotations(); }
    if (delta.annotations) {
      this.update({ annotationVersion: this.current.annotationVersion + 1 });
      this.metadataJobs.annotationsLoad = this.loadAnnotationPaths(this.metadataGeneration);
    }
    if (delta.comments || indexChanged) {
      clearTimeout(this.commentsTimer);
      this.commentsTimer = setTimeout(() => void this.loadComments(), 50);
    }
  }

  private onExternalChange(paths: readonly string[]): void {
    if (this.backend.onCollectionChange) {
      const assets = paths.filter((p) => this.requestedAssets.has(p));
      if (assets.length) void this.loadAssets(assets);
      return;
    }
    if (!paths.length) {
      this.update({ annotationVersion: this.current.annotationVersion + 1 });
      void this.refreshCollection();
      return;
    }
    const annotations = new Set(paths.filter((path) => this.current.annotationPaths.has(path)));
    if (annotations.size) {
      this.update({ annotationVersion: this.current.annotationVersion + 1, annotationsLoad: LOADING });
      this.metadataJobs.annotationsLoad = this.loadAnnotationPaths(this.metadataGeneration);
    }
    // An image, style or template the document uses changed: send its new bytes.
    const assets = paths.filter((p) => this.requestedAssets.has(p));
    if (assets.length) void this.loadAssets(assets);
    // A comment changed elsewhere (or our own write, echoed): only comments need reloading.
    const comments = new Set(this.current.comments.map((c) => c.path));
    if (paths.some((p) => comments.has(p))) {
      clearTimeout(this.commentsTimer);
      this.commentsTimer = setTimeout(() => void this.loadComments(), 300);
    }
    // Record sessions follow their own records (including ones still opening).
    if (paths.every((p) => this.leases.has(p) || this.opening.has(p) || this.requestedAssets.has(p) || comments.has(p) || annotations.has(p))) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refreshCollection(), 2_000);
  }

  private async refreshCollection(): Promise<void> {
    this.loadMetadata(true);
    await Promise.all([...Object.values(this.metadataJobs), this.loadComments()]);
  }

  setBody(path: string, body: string): void {
    if (this.current.recoveredDrafts.has(path)) return;
    this.leases.get(path)?.lease.session.setBody(body);
  }

  /** Whether a record is a Reader annotation (embedded, a quotation). */
  isQuotation(path: string): boolean {
    const view = this.current.records.get(path);
    return this.current.annotationPaths.has(path) || Boolean(view && isAnnotation({ path, body: view.snapshot.body, frontmatter: view.snapshot.frontmatter }));
  }

  /** Whether an embed in the manuscript is a chapter (not a quotation). */
  private isChapter = (target: string): boolean => {
    const path = resolveLinkTarget(target, this.main, this.current.recordIndex);
    return !path || !this.isQuotation(path);
  };

  /** The record each of the manuscript's chapter embeds resolves to (null when none does), in order. */
  chapterPaths(): (string | null)[] {
    const body = this.current.records.get(this.main)?.snapshot.body ?? "";
    const candidates = this.current.recordIndex;
    return chapterEmbeds(body, this.isChapter).map((e) => resolveLinkTarget(e.target, this.main, candidates));
  }

  /** Moves the manuscript's chapter embed at index `from` to index `to`. */
  moveChapter(from: number, to: number): void {
    const body = this.current.records.get(this.main)?.snapshot.body;
    if (body !== undefined) this.setBody(this.main, moveEmbed(body, from, to, this.isChapter));
  }

  /**
   * Creates a record for a new chapter beside the existing chapters (or in
   * chapters/) and embeds it after the last one. Resolves to its path.
   */
  async addChapter(title: string): Promise<Result<string>> {
    const name = title.trim();
    if (!name) return fail("A chapter needs a title.");
    const first = this.chapterPaths().find((p): p is string => Boolean(p));
    const folder = first?.includes("/") ? first.slice(0, first.lastIndexOf("/")) : "chapters";
    const created = await this.backend.createRecord(`${folder}/${manuscriptSlug(name)}.md`, `# ${name}\n\n`);
    if (!created.ok) return created;
    const path = created.value;
    // The index learns the new record (no need to list the collection again), so the embed resolves.
    const recordPaths = [...this.current.recordPaths, path];
    this.update({ recordPaths });
    this.compile.send({ type: "collection", recordPaths, filePaths: this.current.filePaths });
    // Its session opens now, rather than once the manuscript has been typeset with the embed.
    const opened = this.open(path);
    const body = this.current.records.get(this.main)?.snapshot.body ?? "";
    this.setBody(this.main, appendEmbed(body, path.replace(/\.md$/i, ""), this.isChapter));
    await opened;
    return ok(path);
  }

  /** Whether the collection accepts files, so a figure can be stored from the editor. */
  get canStoreFiles(): boolean {
    return typeof this.backend.writeFile === "function";
  }

  /**
   * Stores an image in the collection, next to the manuscript's other figures
   * (its `figures` folder unless one is already used), and resolves to its
   * path. The index learns the file at once, so the figure typesets without a
   * fresh listing.
   */
  async addFigure(file: { name: string; bytes: Uint8Array; type?: string }): Promise<Result<string>> {
    if (!this.backend.writeFile) return fail("This collection does not accept files from Writer.");
    const extension = /\.[a-z0-9]{1,5}$/i.exec(file.name)?.[0]?.toLowerCase() ?? "";
    if (!IMAGE_EXTENSION.test(extension)) return fail("Figures must be PNG, JPEG, GIF, SVG or WebP images.");
    const stem = manuscriptSlug(file.name.slice(0, file.name.length - extension.length)) || "figure";
    const used = [...this.current.fileIndex].find((p) => IMAGE_EXTENSION.test(p) && p.includes("/"));
    const folder = used ? used.slice(0, used.lastIndexOf("/")) : "figures";
    const stored = await this.backend.writeFile(`${folder}/${stem}${extension}`, file.bytes, file.type);
    if (!stored.ok) return stored;
    const path = stored.value;
    this.assetBytes.set(path, file.bytes);
    if (!this.current.fileIndex.has(path)) {
      const filePaths = [...this.current.filePaths, path];
      this.update({ filePaths });
      this.compile.send({ type: "collection", recordPaths: this.current.recordPaths, filePaths });
    }
    return ok(path);
  }

  /** An object URL for an image the manuscript uses, once its bytes are loaded for the preview; null until then. */
  imageUrl(target: string, from: string): string | null {
    const path = resolveLinkTarget(target, from, this.current.fileIndex, "");
    if (!path) return null;
    const known = this.imageUrls.get(path);
    if (known) return known;
    const bytes = this.assetBytes.get(path);
    if (!bytes) {
      // Not needed by the compiler yet (a figure just written); load it for the card.
      if (!this.requestedAssets.has(path)) void this.loadAssets([path]);
      return null;
    }
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: imageType(path) }));
    this.imageUrls.set(path, url);
    return url;
  }

  /** Focused setting drafts are backed up immediately, without typesetting half-parsed fields. */
  stageFrontmatter(path: string, patch: JsonObject): void {
    if (this.current.recoveredDrafts.has(path)) return;
    const raw = this.leases.get(path)?.lease.session.getSnapshot();
    if (!raw || raw.state === "deleted") return;
    const staged = { ...this.stagedSettings.get(path) };
    for (const [key, value] of Object.entries(toLocal(patch, this.fieldsFor(raw.record.types)))) {
      if (JSON.stringify(raw.frontmatter[key]) === JSON.stringify(value)) delete staged[key];
      else staged[key] = value;
    }
    if (Object.keys(staged).length) this.stagedSettings.set(path, staged);
    else this.stagedSettings.delete(path);
    this.update({ pendingSettings: this.stagedSettings.size > 0 });
    this.persistDraft(path, raw);
  }

  patchFrontmatter(path: string, patch: JsonObject): void {
    if (this.current.recoveredDrafts.has(path)) return;
    const session = this.leases.get(path)?.lease.session;
    if (!session || session.getSnapshot().state === "deleted") return;
    const local = toLocal(patch, this.fieldsFor(session.getSnapshot().record.types));
    const staged = { ...this.stagedSettings.get(path) };
    for (const key of Object.keys(local)) delete staged[key];
    if (Object.keys(staged).length) this.stagedSettings.set(path, staged);
    else this.stagedSettings.delete(path);
    this.update({ pendingSettings: this.stagedSettings.size > 0 });
    session.patchFrontmatter(local);
  }

  private commitSettings(): void {
    for (const [path, patch] of [...this.stagedSettings]) {
      const session = this.leases.get(path)?.lease.session;
      if (!session || session.getSnapshot().state === "deleted") continue;
      this.stagedSettings.delete(path);
      session.patchFrontmatter(patch);
    }
    this.update({ pendingSettings: this.stagedSettings.size > 0 });
  }

  /** A new thread on a passage (a suggestion when `replacement` is given), or on the whole record. */
  async addComment(draft: CommentDraft | { record: string }, text: string, replacement?: string): Promise<Result<CommentRecord>> {
    const target = "body" in draft ? targetFor(draft.body, draft.from, draft.to, await bodyHash(draft.body)) : undefined;
    const created = await this.backend.createComment({ document: draft.record, text, ...(target ? { target } : {}), ...(replacement !== undefined ? { replacement } : {}) });
    if (created.ok) this.update({ comments: [...this.current.comments, created.value] });
    return created;
  }

  async reply(thread: CommentThread, text: string): Promise<Result<CommentRecord>> {
    // A reply repeats its thread's document.
    const document = resolveLinkTarget(linkPath(thread.root.document), thread.root.path, this.current.recordIndex) ?? linkPath(thread.root.document);
    const created = await this.backend.createComment({ document, text, thread: thread.root });
    if (created.ok) this.update({ comments: [...this.current.comments, created.value] });
    return created;
  }

  async changeComment(comment: CommentRecord, change: CommentChange): Promise<Result<CommentRecord>> {
    const changed = await this.backend.changeComment(comment, change);
    if (changed.ok) this.update({ comments: this.current.comments.map((c) => (c.path === comment.path ? changed.value : c)) });
    return changed;
  }

  /**
   * Makes a suggestion's edit in the record it is on, then resolves it as
   * accepted. Refuses, leaving it open, when its text is no longer there.
   */
  async acceptSuggestion(record: string, suggestion: CommentRecord): Promise<Result<CommentRecord>> {
    const body = this.current.records.get(record)?.snapshot.body;
    if (body === undefined || !suggestion.target || !suggestion.suggestion) return fail("That record is not open.");
    const next = applySuggestion(body, suggestion.target, suggestion.suggestion.replacement);
    if (next === null) return fail("The suggested text is no longer in the record; edit it by hand, then resolve the suggestion.");
    this.setBody(record, next);
    return this.changeComment(suggestion, { kind: "resolve", outcome: "accepted" });
  }

  resolveConflict(path: string, keep: "mine" | "theirs" | { body: string }): void {
    this.leases.get(path)?.lease.session.resolve(typeof keep === "string" ? { keep } : keep);
  }

  hasUnsavedChanges(): boolean {
    return this.stagedSettings.size > 0 || this.current.recoveredDrafts.size > 0 || [...this.current.records.values()].some((view) => view.snapshot.dirty || view.snapshot.state === "conflict");
  }

  async retrySave(path?: string): Promise<Result<void>> {
    this.commitSettings();
    const problems: string[] = [];
    await Promise.all([...this.leases].filter(([at]) => !path || at === path).map(async ([at, { lease }]) => {
      try {
        if (lease.session.getSnapshot().state === "deleted") { problems.push(`${at}: this record was deleted; download the local draft before leaving.`); return; }
        const out = await lease.session.flush({ timeoutMs: 15_000 });
        if (!out.ok) problems.push(`${at}: ${out.problem.message ?? out.problem.code}`);
      } catch (error) { problems.push(`${at}: ${errorMessage(error)}`); }
    }));
    if (this.current.recoveredDrafts.size) problems.push("Review the recovered local drafts before leaving.");
    return problems.length ? fail(problems.join("\n")) : ok(undefined);
  }

  restoreDraft(path: string): void {
    const draft = this.current.recoveredDrafts.get(path);
    const session = this.leases.get(path)?.lease.session;
    if (!draft || !session || session.getSnapshot().state === "deleted") return;
    const recoveredDrafts = new Map(this.current.recoveredDrafts);
    recoveredDrafts.delete(path);
    this.update({ recoveredDrafts });
    session.setBody(draft.body);
    session.patchFrontmatter(draftPatch(draft));
  }

  discardDraft(path: string): void {
    this.drafts.remove(path);
    const recoveredDrafts = new Map(this.current.recoveredDrafts);
    recoveredDrafts.delete(path);
    this.update({ recoveredDrafts });
  }

  localDrafts(): readonly [string, string][] {
    const paths = new Set([...this.current.records.keys(), ...this.current.recoveredDrafts.keys()]);
    return [...paths].map((path) => {
      const view = this.current.records.get(path);
      const recovered = this.current.recoveredDrafts.get(path);
      const raw = this.leases.get(path)?.lease.session.getSnapshot();
      const frontmatter = recovered?.frontmatter ?? { ...(raw?.frontmatter ?? view?.snapshot.frontmatter ?? {}), ...this.stagedSettings.get(path) };
      return [path, `---\n${JSON.stringify(frontmatter, null, 2)}\n---\n\n${recovered?.body ?? view?.snapshot.body ?? ""}`];
    });
  }

  annotationsForSource = (path: string): ReturnType<WriterBackend["annotationsForSource"]> => this.backend.annotationsForSource(path);

  /** Independent of preview timing: discover and await all embeds, styles and images. */
  private async preflight(signal?: AbortSignal) {
    const check = () => {
      signal?.throwIfAborted();
      if (this.disposed) throw new Error("The manuscript was closed.");
      if (this.current.phase !== "ready") throw new Error("Wait for the manuscript to open before exporting.");
    };
    check();
    this.commitSettings();
    const changes = await this.backend.flushChanges?.();
    if (changes && !changes.ok) throw new Error(changes.message);
    await this.metadata();
    check();
    const { styles, locales } = await loadStyles();
    const assembler = new ManuscriptAssembler();
    const attemptedRecords = new Set<string>();
    const attemptedAssets = new Set<string>();
    for (let pass = 0; pass < 100; pass++) {
      check();
      const snap = this.current;
      const input: AssemblyInput = {
        main: this.main, records: new Map(this.writerRecords().map((record) => [record.path, record])),
        recordPaths: snap.recordIndex, filePaths: snap.fileIndex,
        library: new Map(snap.library.map((entry) => [entry.key, entry.item])), styles, locales,
        texts: new Map(this.texts), annotationPaths: snap.annotationPaths, sourceKeys: sourceKeys(snap.library),
      };
      const assembly = assembler.assemble(input);
      const records = assembly.unloaded.filter((path) => !attemptedRecords.has(path));
      const assets = assembly.assets.filter((path) => !attemptedAssets.has(path));
      if (!records.length && !assets.length) {
        const problems = [...new Set([
          ...(snap.annotationsLoad.phase === "failed" ? [`Annotation discovery unavailable: ${snap.annotationsLoad.problem}. Quotation metadata may be incomplete.`] : []),
          ...assembly.diagnostics.map((diagnostic) => `${diagnostic.record}: ${diagnostic.message}`),
          ...assembly.unloaded.map((path) => `${path}: ${snap.recordProblems.get(path) ?? "Not loaded; it will be left out."}`),
          ...assembly.assets.flatMap((path) => snap.assetProblems.has(path) ? [`${path}: ${snap.assetProblems.get(path)}`] : []),
          ...assembly.order.flatMap((path) => snap.recoveredDrafts.has(path) ? [`${path}: A recovered draft has not been reviewed; the collection version will be exported.`] : []),
        ])];
        return { input, assembly, problems };
      }
      for (const path of records) attemptedRecords.add(path);
      for (const path of assets) attemptedAssets.add(path);
      await Promise.all([
        mapConcurrent(records, 4, (path) => this.open(path)),
        this.loadAssets(assets),
      ]);
    }
    throw new Error("The manuscript kept changing while export dependencies were loading. Pause editing and try again.");
  }

  async exportPdf(signal?: AbortSignal): Promise<{ bytes?: Uint8Array; error?: string; problems: readonly string[] }> {
    const { assembly, problems } = await this.preflight(signal);
    if (this.current.previewProblem) await this.retryPreview();
    await this.compile.ready;
    signal?.throwIfAborted();
    const out = await this.compile.exportPdf([...assembly.sources], signal);
    return { ...out, problems };
  }

  private async materialize(crossReferences: "quarto" | "resolved", signal?: AbortSignal) {
    const prepared = await this.preflight(signal);
    const out = materialize({ ...prepared.input, crossReferences });
    const problems = [...new Set([...prepared.problems, ...out.problems])];
    const media: [string, Uint8Array][] = [];
    for (const [collectionPath, bundled] of out.media) {
      const bytes = this.assetBytes.get(collectionPath);
      if (bytes && !this.current.assetProblems.has(collectionPath)) media.push([bundled, bytes.slice()]);
    }
    return { out, media, problems, meta: prepared.assembly.meta };
  }

  /**
   * A Pandoc/Quarto bundle (zip): the manuscript as one Markdown file with
   * embeds inlined, the cited sources as CSL-JSON, the style and the images.
   */
  async exportBundle(signal?: AbortSignal): Promise<{ bytes: Uint8Array; problems: readonly string[] }> {
    const { out, media, problems } = await this.materialize("quarto", signal);
    signal?.throwIfAborted();
    const files: [string, Uint8Array | string][] = [
      ["manuscript.md", out.markdown],
      ["references.json", `${JSON.stringify(out.references, null, 2)}\n`],
      ["style.csl", out.styleXml],
      ["README.md", BUNDLE_README],
      ...media,
    ];
    return { bytes: zip(files), problems };
  }

  /**
   * A Word document, made in the browser by Pandoc: cross-references are
   * resolved to text, citations formatted by Pandoc's citeproc with the same
   * style, and the layout's reference document supplies the Word styles.
   */
  async exportDocx(signal?: AbortSignal): Promise<{ bytes?: Uint8Array; error?: string; problems: readonly string[] }> {
    const { out, media, problems, meta } = await this.materialize("resolved", signal);
    if (meta.customTemplate) problems.push("Your custom Typst layout applies to PDF only. Word uses the article styles; pagination and layout will differ.");
    const template = meta.customTemplate ? "article" : meta.template;
    // The layout's Word styles (public/docx, from scripts/reference-docx.mjs).
    const referenceResponse = await fetchChecked(`${import.meta.env.BASE_URL}docx/${template}.docx`, signal);
    const reference = new Uint8Array(await referenceResponse.arrayBuffer());
    signal?.throwIfAborted();
    const converted = await toDocx(out.markdown, [
      ["references.json", JSON.stringify(out.references)],
      ["style.csl", out.styleXml],
      ["reference.docx", reference],
      ...media,
    ], signal);
    if (converted.error !== undefined) return { error: converted.error, problems };
    return { bytes: converted.bytes, problems: [...problems, ...converted.warnings] };
  }

  /** Saves what is left, then releases every session and stops the worker. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.commitSettings();
    this.disposed = true;
    for (const url of this.imageUrls.values()) URL.revokeObjectURL(url);
    this.imageUrls.clear();
    clearTimeout(this.refreshTimer);
    clearTimeout(this.commentsTimer);
    for (const timer of this.retryTimers) clearTimeout(timer);
    for (const c of [...this.cleanups, ...this.compileCleanups]) c();
    this.compile.terminate();
    await Promise.all([...this.leases.values()].map(async ({ lease, unsubscribe }) => {
      unsubscribe();
      try { await lease.session.flush({ timeoutMs: 15_000 }); }
      catch { /* The synchronous local draft remains available for recovery. */ }
      finally { lease.release(); }
    }));
    this.leases.clear();
  }
}

const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", svg: "image/svg+xml", webp: "image/webp" };
function imageType(path: string): string {
  return IMAGE_TYPES[path.slice(path.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream";
}
