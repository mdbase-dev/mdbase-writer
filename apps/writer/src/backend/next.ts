// The writer on an mdbase-next replica through `@mdbase-dev/sdk` (opt-in).
//
// - Discovery is one live query over the collection without bodies: its
//   snapshot fills the same CollectionStore as Connect discovery, and its
//   diffs replace watch polling and the `readMany` refetch.
// - Bodies are read on demand with `get(id, { body: true })`, only for the
//   records a view needs (open records, comment threads, a source's
//   annotations).
// - Record sessions save with `update(view, { patch, body })`, so concurrent
//   edits merge on the replica (see next-session.ts).
// - Files are listed once and kept current from the change feed.
import { isMdbaseError, toPlain, type CreateInput, type FileView, type Hold, type LinkState, type LiveQuery, type LiveQueryState, type MdbaseClient, type QueryUpdate, type RecordView, type SyncStatus, type Write } from "@mdbase-dev/sdk";
import type { CollectionDescription, JsonObject, QueryRecord } from "@mdbase-dev/connect";
import { commentFromRecord, type CommentRecord } from "@mdbase-writer/core/comments";

import { mapConcurrent } from "../async.js";
import { CollectionBodies } from "./bodies.js";
import { CollectionCache } from "./cache.js";
import { CollectionSchema, CollectionStore, starterSchema, type Binding, type CollectionRow, type StoreDelta } from "./collection.js";
import { changeFields, commentPath, newCommentFields, toContract, toLocal, type CommentChange, type NewComment, type People } from "./comments.js";
import { isPathTaken, problemFrom, problemFromWire, type NextProblem } from "./next-errors.js";
import { asPlain, NextRecordSession, plainFrontmatter } from "./next-session.js";
import {
  fail,
  manuscriptBody,
  manuscriptSlug,
  numberedPath,
  ok,
  titleFromNote,
  withType,
  type CollectionDelta,
  type CollectionIndex,
  type LibraryEntry,
  type ManuscriptSummary,
  type NewManuscript,
  type RecordOpenOptions,
  type Result,
  type SessionProblem,
  type SourceAnnotation,
  type WriterBackend,
  type WriterRecords,
} from "./types.js";

const WITH_BODY = { body: true } as const;
type ChangesResult = Parameters<Parameters<MdbaseClient["watchChanges"]>[1]>[0];
const BODY_READS = 8;
const CREATE_ATTEMPTS = 20;

export interface NextBackendOptions {
  readonly collectionName?: string;
  /** Stable, non-secret identity for local drafts. Defaults to the collection ID. */
  readonly draftNamespace?: string;
  /** Close the client when the backend is disposed. */
  readonly ownsClient?: boolean;
}

/** The link, sync status and holds, for a status line or a waiting screen. */
export interface NextSync {
  readonly link: LinkState;
  /** Why the link is not open. `waitingForDevice` is a state, not an error. */
  readonly problem: NextProblem | null;
  readonly status: SyncStatus;
  readonly holds: number;
  /** The last write that the log rejected after the replica accepted it. */
  readonly writeProblem?: string;
}

const fieldsOf = (fm: JsonObject, binding: Binding) => (Object.keys(binding.fields).length ? toContract(fm, binding.fields) : fm);

function row(view: RecordView): CollectionRow {
  const frontmatter = plainFrontmatter(view);
  return { path: view.path, types: view.types, frontmatter, effectiveFrontmatter: view.effective ? (toPlain(view.effective) as JsonObject) : frontmatter };
}

/**
 * Writer's type bindings from `describe()`. A replica that reports contract
 * implementations gets them; one that does not (MemoryReplica, and replicas
 * until `describe` carries contracts) is read with the starter type names.
 */
export function nextSchema(described: unknown): CollectionSchema {
  const d = (described && typeof described === "object" && !Array.isArray(described) ? described : {}) as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === "object") : []);
  const text = (value: unknown) => (typeof value === "string" ? value : undefined);
  const contracts: CollectionDescription["contracts"] = list(d["contracts"]).flatMap((c) => {
    const id = text(c["id"]), version = text(c["version"]);
    if (!id || !version) return [];
    const implementations = list(c["implementations"]).flatMap((i) => {
      const typeName = text(i["typeName"] ?? i["type_name"] ?? i["type"]);
      const fields = i["fields"] && typeof i["fields"] === "object" ? Object.fromEntries(Object.entries(i["fields"] as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === "string")) : {};
      return typeName ? [{ typeName, typeVersion: 1, digest: "next", fields }] : [];
    });
    return [{ id, version, contractType: "record" as const, digest: "next", schema: {}, implementations }];
  });
  if (!contracts.length) return starterSchema();
  const types = (Array.isArray(d["types"]) ? d["types"] : []).flatMap((t: unknown) => {
    const name = typeof t === "string" ? t : t && typeof t === "object" ? text((t as Record<string, unknown>)["name"]) : undefined;
    return name ? [{ name, schema: {}, extensions: {} }] : [];
  });
  const configuration = d["configuration"] && typeof d["configuration"] === "object" ? (d["configuration"] as JsonObject) : undefined;
  return new CollectionSchema({ types, contracts, ...(configuration ? { configuration } : {}) });
}

interface SessionEntry { readonly session: NextRecordSession; holders: number }

export class NextBackend implements WriterBackend {
  readonly kind = "next";
  private readonly store = new CollectionStore(starterSchema());
  get setupStatus() { return this.store.schema.setupStatus; }
  private readonly bodies = new CollectionBodies(() => this.store, (metadata) => this.selectedBodies(metadata));
  private readonly bodyCache = new Map<string, CollectionCache<string>>();
  private readonly live: LiveQuery;
  private readonly pathOf = new Map<string, string>();
  private readonly idOf = new Map<string, string>();
  private readonly files = new Map<string, FileView>();
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly listeners = new Set<(paths: readonly string[]) => void>();
  private readonly dataListeners = new Set<(delta: CollectionDelta) => void>();
  private readonly syncListeners = new Set<(sync: NextSync) => void>();
  private readonly moveListeners = new Set<(move: { readonly from: string; readonly to: string }) => void>();
  private readonly cleanups: (() => void)[] = [];
  private readonly ready: Promise<Result<void>>;
  private holds: readonly Hold[] = [];
  private described = false;
  private discovered = false;
  private disposed = false;
  private sync: NextSync;

  readonly records: WriterRecords = { open: (path, options) => this.openRecord(path, options) };

  constructor(private readonly client: MdbaseClient, private readonly options: NextBackendOptions = {}) {
    this.sync = { link: client.link, problem: client.linkProblem ? problemFrom(client.linkProblem) : null, status: client.status, holds: 0 };
    // Every record, frontmatter only: lists and classification never need bodies.
    this.live = client.live({}, { effective: true });
    this.cleanups.push(this.live.subscribe((state, update) => this.onLive(state, update)));
    this.ready = this.start();
  }

  get collectionName(): string { return this.options.collectionName ?? "Collection"; }
  get draftNamespace(): string { return this.options.draftNamespace ?? this.client.collection; }

  /** Current link and sync state; `listener` runs now and on every change. */
  onSync(listener: (sync: NextSync) => void): () => void {
    this.syncListeners.add(listener);
    listener(this.sync);
    return () => this.syncListeners.delete(listener);
  }

  private setSync(next: Partial<NextSync>): void {
    this.sync = { ...this.sync, ...next };
    for (const listener of [...this.syncListeners]) listener(this.sync);
  }

  private async start(): Promise<Result<void>> {
    this.cleanups.push(
      this.client.onLink((link, why) => this.setSync({ link, problem: why ? problemFrom(why) : null })),
      this.client.onStatus((status) => this.setSync({ status })),
    );
    try { this.store.schema = nextSchema(toPlain(await this.client.describe())); }
    catch (error) { return fail(problemFrom(error).message); }
    // Classification needs the schema: a snapshot that came first is applied now.
    this.described = true;
    if (!this.live.stale) this.applySnapshot(this.live.records);
    try { await this.live.ready; }
    catch (error) { return fail(problemFrom(error).message); }
    const files = await this.listFiles();
    if (!files.ok) return files;
    if (this.disposed) return ok(undefined);
    this.cleanups.push(
      this.client.watchChanges(undefined, (batch) => void this.onChanges(batch)),
      this.client.onHolds((holds) => this.onHolds(holds)),
    );
    return ok(undefined);
  }

  // ---------------------------------------------------------------- discovery

  private onLive(state: LiveQueryState, update: QueryUpdate | null): void {
    // Stale marks and resubscribe errors keep the last good result.
    if (this.disposed || !this.described || !update || update.kind === "reset") return;
    if (update.kind === "snapshot") this.applySnapshot(state.records);
    else this.applyDiff(update);
  }

  private applySnapshot(records: readonly RecordView[]): void {
    const present = new Set(records.map((r) => r.id));
    const removed = [...this.pathOf].filter(([id]) => !present.has(id)).map(([, path]) => path);
    this.pathOf.clear();
    this.idOf.clear();
    for (const r of records) { this.pathOf.set(r.id, r.path); this.idOf.set(r.path, r.id); }
    if (!this.discovered) {
      this.store.upsert(records.map(row), true);
      this.discovered = true;
      return;
    }
    // A snapshot after a reset or reconnect: reconcile everything cached.
    this.bodyCache.clear();
    this.bodies.clear();
    const upsert = this.store.upsert(records.map(row)), gone = this.store.remove(removed);
    this.acceptDelta({ ...upsert, ...gone, paths: [], reset: true, annotationSources: null });
    for (const listener of this.listeners) listener([]);
    for (const [id, entry] of this.sessions) {
      const view = records.find((r) => r.id === id);
      if (view) entry.session.receive(view); else entry.session.markDeleted();
    }
  }

  private applyDiff(update: QueryUpdate): void {
    const views = [...update.added ?? [], ...update.changed ?? []];
    const removed: string[] = [];
    for (const id of update.removed ?? []) {
      const path = this.pathOf.get(id);
      if (path === undefined) continue;
      removed.push(path);
      this.pathOf.delete(id);
      if (this.idOf.get(path) === id) this.idOf.delete(path);
    }
    for (const view of views) {
      const before = this.pathOf.get(view.id);
      if (before !== undefined && before !== view.path) { removed.push(before); this.idOf.delete(before); }
      this.pathOf.set(view.id, view.path);
      this.idOf.set(view.path, view.id);
    }
    const paths = [...new Set([...views.map((v) => v.path), ...removed])];
    if (!paths.length) return;
    for (const path of paths) this.bodyCache.delete(path);
    const upsert = this.store.upsert(views.map(row)), gone = this.store.remove(removed.filter((p) => !this.idOf.has(p)));
    this.acceptDelta({ ...upsert, ...gone, paths,
      annotationSources: upsert.annotationSources === null || gone.annotationSources === null
        ? null : [...upsert.annotationSources ?? [], ...gone.annotationSources ?? []] });
    for (const listener of this.listeners) listener(paths);
    for (const view of views) this.sessions.get(view.id)?.session.receive(view);
    for (const id of update.removed ?? []) this.sessions.get(id)?.session.markDeleted();
  }

  private acceptDelta(delta: StoreDelta): void {
    this.bodies.changed(delta);
    const { annotationSources: _sources, ...rest } = delta;
    this.publish(rest);
  }

  private publish(delta: CollectionDelta): void {
    if (!this.disposed && this.discovered) for (const listener of this.dataListeners) listener(delta);
  }

  // ---------------------------------------------------------------- files

  private async listFiles(): Promise<Result<void>> {
    const files = new Map<string, FileView>();
    try { for await (const file of this.client.files.list()) files.set(file.path, file); }
    catch (error) { return fail(problemFrom(error).message); }
    const removed = [...this.files.keys()].filter((p) => !files.has(p));
    this.files.clear();
    for (const [path, file] of files) this.files.set(path, file);
    const delta = this.store.files([...files.keys()], removed);
    if (delta.index) this.acceptDelta(delta);
    return ok(undefined);
  }

  /** The change feed is a fallback here: records follow the live query, files follow this. */
  private async onChanges(batch: ChangesResult): Promise<void> {
    if (this.disposed) return;
    if (batch.reset) { await this.listFiles(); return; }
    const present: string[] = [], removed: string[] = [];
    for (const change of batch.changes) {
      if (/\.md$/i.test(change.path)) continue;
      if (change.kind === "remove") { if (this.files.delete(change.path)) removed.push(change.path); continue; }
      try {
        const file = await this.client.files.get(change.path);
        this.files.set(file.path, file);
        present.push(file.path);
      } catch (error) {
        if (isMdbaseError(error, "not_found") && this.files.delete(change.path)) removed.push(change.path);
      }
    }
    if (!present.length && !removed.length) return;
    this.acceptDelta(this.store.files(present, removed));
    for (const listener of this.listeners) listener([...present, ...removed]);
  }

  async readFile(path: string): Promise<Result<Uint8Array>> {
    const file = this.files.get(path);
    if (!file) return fail(`No file at ${path}.`);
    try { return ok(await this.client.files.download(file)); }
    catch (error) { return fail(problemFrom(error).message); }
  }

  // ---------------------------------------------------------------- holds

  private onHolds(holds: readonly Hold[]): void {
    this.holds = holds;
    this.setSync({ holds: holds.length });
    for (const { session } of this.sessions.values()) session.setHold(holds.find((h) => h.path === session.path) ?? null);
  }

  // ---------------------------------------------------------------- record sessions

  private async openRecord(path: string, options: RecordOpenOptions = {}): Promise<{ ok: true; value: { session: NextRecordSession; release(): void } } | { ok: false; problem: SessionProblem }> {
    const started = await this.ready;
    if (!started.ok) return { ok: false, problem: { code: "unavailable", message: started.message } };
    const known = this.idOf.get(path);
    let entry = known ? this.sessions.get(known) : undefined;
    if (!entry) {
      let view: RecordView;
      try { view = await this.client.get(known ?? { path }, WITH_BODY, options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined); }
      catch (error) { return { ok: false, problem: problemFrom(error) }; }
      entry = this.sessions.get(view.id);
      if (!entry) {
        const idleMs = options.autosave === false ? false : options.autosave?.idleMs ?? 1_000;
        const session = new NextRecordSession(this.client, { ...view, body: view.body ?? "" }, idleMs);
        session.setHold(this.holds.find((h) => h.path === view.path) ?? null);
        entry = { session, holders: 0 };
        this.sessions.set(view.id, entry);
      }
    }
    const held = entry;
    held.holders++;
    let released = false;
    return { ok: true, value: { session: held.session, release: () => {
      if (released) return;
      released = true;
      held.holders--;
      void this.retire(held);
    } } };
  }

  /** Drop an unheld session once it has nothing left to save. */
  private async retire(entry: SessionEntry): Promise<void> {
    if (entry.holders > 0) return;
    if (!entry.session.idle) await entry.session.flush();
    if (entry.holders > 0 || !entry.session.idle) return;
    entry.session.dispose();
    if (this.sessions.get(entry.session.id) === entry) this.sessions.delete(entry.session.id);
  }

  // ---------------------------------------------------------------- domains

  private async afterDiscovery<T>(value: () => T): Promise<Result<T>> {
    const started = await this.ready;
    return started.ok ? ok(value()) : started;
  }

  manuscriptBindings() { return this.afterDiscovery(() => this.store.schema.bindings("manuscript", true)).then((r) => (r.ok ? r.value : r)); }
  listManuscripts(): Promise<Result<ManuscriptSummary[]>> { return this.afterDiscovery(() => this.store.manuscripts); }
  index(): Promise<Result<CollectionIndex>> { return this.afterDiscovery(() => this.store.index); }
  library(): Promise<Result<LibraryEntry[]>> { return this.afterDiscovery(() => this.store.library); }
  annotationPaths(): Promise<Result<readonly string[]>> { return this.afterDiscovery(() => [...this.store.annotations.keys()]); }

  annotationFields(path: string, types: readonly string[] = []): Readonly<Record<string, string>> {
    return this.store.annotations.get(path)?.fields ?? this.store.schema.annotationFields(types);
  }

  async annotationsForSource(path: string): Promise<Result<SourceAnnotation[]>> {
    const started = await this.ready;
    return started.ok ? this.bodies.annotationsForSource(path) : started;
  }

  async comments(scope?: readonly string[]): Promise<Result<CommentRecord[]>> {
    const started = await this.ready;
    if (!started.ok) return started;
    if (!this.setupStatus.comments) return ok([]);
    return this.bodies.commentsForScope(scope);
  }

  /** Bodies for the selected records only, a few reads at a time. */
  private async selectedBodies(metadata: ReadonlyMap<string, { readonly type: string }>): Promise<Result<QueryRecord<JsonObject>[]>> {
    try {
      const rows = await mapConcurrent([...metadata.keys()], BODY_READS, async (path) => {
        const view = await this.client.find(this.idOf.get(path) ?? { path }, WITH_BODY);
        if (!view) return null;
        const frontmatter = plainFrontmatter(view);
        return { path: view.path, types: view.types, frontmatter, effectiveFrontmatter: frontmatter, body: view.body ?? "", file: { path: view.path } } satisfies QueryRecord<JsonObject>;
      });
      return ok(rows.filter((r): r is NonNullable<typeof r> => r !== null));
    } catch (error) { return fail(problemFrom(error).message); }
  }

  readBody(path: string): Promise<Result<string>> {
    let cache = this.bodyCache.get(path);
    if (!cache) this.bodyCache.set(path, cache = new CollectionCache());
    return cache.load(async () => {
      try { return ok((await this.client.get(this.idOf.get(path) ?? { path }, WITH_BODY)).body ?? ""); }
      catch (error) { return fail(problemFrom(error).message); }
    });
  }

  // ---------------------------------------------------------------- writes

  /**
   * Creates at `pathFor(1)`, then numbered paths while the replica answers
   * `conflict` (`path_taken`). Resolves once the replica holds the record
   * (pending). The same applies when the log rejects the path later: the
   * rejected record is rolled back, a fresh create (new record and mutation
   * IDs) tries the next numbered path, and `onRecordMoved` reports the move.
   */
  private async createAt(pathFor: (n: number) => string, input: Omit<CreateInput, "path">, from = 1): Promise<Result<string>> {
    let last = "";
    for (let n = from; n <= CREATE_ATTEMPTS; n++) {
      const path = pathFor(n);
      try {
        const write = await this.client.create({ ...input, path });
        if (write.state === "rejected" || write.state === "unknown") {
          const problem = problemFromWire(write.receipt.problem, write.state === "unknown" ? "outcome_unknown" : "internal");
          if (isPathTaken(write.receipt.problem)) { last = problem.message; continue; }
          return fail(problem.message);
        }
        const created = write.records[0]?.path ?? path;
        write.confirmed.catch((error: unknown) => this.lateCreateFailure(error, write, created, pathFor, input, n));
        return ok(created);
      } catch (error) {
        if (isMdbaseError(error) && isPathTaken(error)) { last = problemFrom(error).message; continue; }
        return fail(problemFrom(error).message);
      }
    }
    return fail(last);
  }

  private async lateCreateFailure(error: unknown, write: Write, path: string, pathFor: (n: number) => string, input: Omit<CreateInput, "path">, n: number): Promise<void> {
    if (this.disposed) return;
    if (!isMdbaseError(error) || !isPathTaken(error) || n >= CREATE_ATTEMPTS) { this.writeProblem(path, error); return; }
    // Keep what was written into the optimistic record meanwhile.
    const id = write.records[0]?.id;
    const local = id ? this.sessions.get(id)?.session.getSnapshot() : undefined;
    const carried = local ? { ...input, frontmatter: asPlain(local.frontmatter), body: local.body } : input;
    const retried = await this.createAt(pathFor, carried, n + 1);
    if (!retried.ok) { this.writeProblem(path, retried.message); return; }
    if (this.disposed) return;
    for (const listener of [...this.moveListeners]) listener({ from: path, to: retried.value });
  }

  /** A write that failed after it was accepted; shown on the status line. */
  private writeProblem(path: string, error: unknown): void {
    this.setSync({ writeProblem: `${path}: ${typeof error === "string" ? error : problemFrom(error).message}` });
  }

  /** A record created here moved to another path (its first path was taken at the log). */
  onRecordMoved(listener: (move: { readonly from: string; readonly to: string }) => void): () => void {
    this.moveListeners.add(listener);
    return () => this.moveListeners.delete(listener);
  }

  async createManuscript(input: NewManuscript): Promise<Result<string>> {
    const started = await this.ready;
    if (!started.ok) return started;
    const bindings = this.store.schema.bindings("manuscript", true);
    if (!bindings.ok) return bindings;
    const { name, fields, typeKey } = bindings.value[0] as Binding;
    const frontmatter: JsonObject = { [typeKey]: name, [fields["title"] ?? "title"]: input.title };
    if (fields["template"]) frontmatter[fields["template"]] = input.template;
    if (fields["csl"]) frontmatter[fields["csl"]] = input.style;
    const slug = manuscriptSlug(input.title);
    const body = manuscriptBody(input.starter, input.starter ? this.store.library[0]?.key : undefined);
    return this.createAt((n) => `manuscripts/${slug}${n > 1 ? `-${n}` : ""}.md`, { type: name, frontmatter: asPlain(frontmatter), body });
  }

  createRecord(path: string, body: string): Promise<Result<string>> {
    return this.createAt((n) => numberedPath(path, n), { frontmatter: {}, body });
  }

  async adoptManuscript(path: string): Promise<Result<string>> {
    const started = await this.ready;
    if (!started.ok) return started;
    const bindings = this.store.schema.bindings("manuscript", true);
    if (!bindings.ok) return bindings;
    const { name, fields, typeKey } = bindings.value[0] as Binding;
    try {
      const view = await this.client.get(this.idOf.get(path) ?? { path }, WITH_BODY);
      const fm = plainFrontmatter(view);
      const titleField = fields["title"] ?? "title";
      const patch: JsonObject = { [typeKey]: withType(fm[typeKey], name) };
      if (typeof fm[titleField] !== "string" || !fm[titleField]) patch[titleField] = titleFromNote(path, view.body ?? "");
      const write = await this.client.update(view, { patch: asPlain(patch) });
      if (write.state === "rejected" || write.state === "unknown") return fail(problemFromWire(write.receipt.problem).message);
      write.confirmed.catch((error: unknown) => this.writeProblem(path, error));
      return ok(write.records[0]?.path ?? path);
    } catch (error) { return fail(problemFrom(error).message); }
  }

  async createComment(input: NewComment): Promise<Result<CommentRecord>> {
    const started = await this.ready;
    if (!started.ok) return started;
    const bindings = this.store.schema.bindings("comment", true);
    if (!bindings.ok) return bindings;
    const type = bindings.value[0] as Binding;
    const now = new Date();
    const fields = newCommentFields(input, now, (await this.people()).me?.link);
    const text = input.text.trim();
    const created = await this.createAt(() => commentPath(now), {
      type: type.name,
      frontmatter: asPlain({ [type.typeKey]: type.name, ...toLocal(fields, type.fields) }),
      body: text ? `${text}\n` : "",
    });
    if (!created.ok) return created;
    const comment = commentFromRecord(created.value, fields, input.text);
    return comment ? ok(comment) : fail("The comment was written but could not be read back.");
  }

  async changeComment(comment: CommentRecord, change: CommentChange): Promise<Result<CommentRecord>> {
    const started = await this.ready;
    if (!started.ok) return started;
    const bindings = this.store.schema.bindings("comment", true);
    if (!bindings.ok) return bindings;
    try {
      const view = await this.client.get(this.idOf.get(comment.path) ?? { path: comment.path }, WITH_BODY);
      const type = bindings.value.find((t) => view.types.includes(t.name)) ?? (bindings.value[0] as Binding);
      const { fields, body } = changeFields(comment, change, new Date(), (await this.people()).me?.link);
      const write = await this.client.update(view, { patch: asPlain(toLocal(fields, type.fields)), ...(body !== undefined ? { body } : {}) });
      if (write.state === "rejected" || write.state === "unknown") return fail(problemFromWire(write.receipt.problem).message);
      write.confirmed.catch((error: unknown) => this.writeProblem(comment.path, error));
      const after = write.records.find((r) => r.id === view.id);
      const next = commentFromRecord(comment.path, fieldsOf(after ? plainFrontmatter(after) : { ...plainFrontmatter(view), ...toLocal(fields, type.fields) }, type), body ?? after?.body ?? comment.text);
      return next ? ok(next) : fail("The comment was changed but could not be read back.");
    } catch (error) { return fail(problemFrom(error).message); }
  }

  /**
   * Person records' names from discovery. mdbase-next has no people directory
   * (account → person record) yet, so new comments are not signed.
   */
  async people(): Promise<People> {
    await this.ready;
    return { names: this.store.people, signing: { kind: "unavailable", reason: "mdbase-next has no people directory yet, so new comments are not signed." } };
  }

  // ---------------------------------------------------------------- changes

  onExternalChange(listener: (paths: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onCollectionChange(listener: (delta: CollectionDelta) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  /** Live diffs are applied as they arrive: there is no queue to drain. */
  async flushChanges(): Promise<Result<void>> {
    const started = await this.ready;
    return started.ok ? ok(undefined) : started;
  }

  /** Ask for a fresh snapshot; it replaces everything cached. */
  async reconcile(): Promise<Result<void>> {
    const started = await this.ready;
    if (!started.ok) return started;
    try {
      await this.live.setQuery({}, { effective: true });
      await this.listFiles();
      return ok(undefined);
    } catch (error) { return fail(problemFrom(error).message); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.live.close();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const { session } of this.sessions.values()) session.dispose();
    this.sessions.clear();
    this.listeners.clear();
    this.dataListeners.clear();
    this.syncListeners.clear();
    this.moveListeners.clear();
    if (this.options.ownsClient) this.client.close();
  }
}
