// The writer on a real collection through mdbase connect.
import { type CollectionFileDescriptor, type JsonObject, type QueryInput, type QueryRecord, type MdbaseConnection } from "@mdbase-dev/connect";
import { commentFromRecord, type CommentRecord } from "@mdbase-writer/core/comments";
import { CollectionSchema, CollectionStore, type Binding, type Domain, type StoreDelta } from "./collection.js";
export { annotationContract, commentContract, manuscriptContract, sourceContract } from "./collection.js";
import { CollectionCache } from "./cache.js";
import { CollectionBodies } from "./bodies.js";
import { errorMessage } from "../async.js";

import {
  changeFields,
  commentPath,
  newCommentFields,
  NO_PEOPLE,
  peopleFromDirectory,
  signingFromProblem,
  toContract,
  toLocal,
  type CommentChange,
  type NewComment,
  type People,
} from "./comments.js";
import {
  manuscriptBody,
  fail,
  manuscriptSlug,
  numberedPath,
  ok,
  titleFromNote,
  withType,
  type CollectionIndex,
  type CollectionDelta,
  type LibraryEntry,
  type ManuscriptSummary,
  type NewManuscript,
  type Result,
  type SourceAnnotation,
  type WriterBackend,
} from "./types.js";

type ImplementingType = Binding;
const problemMessage = (outcome: { ok: false; problem: { message?: string; code: string } }) => outcome.problem.message ?? outcome.problem.code;

export class ConnectBackend implements WriterBackend {
  readonly kind = "connect";
  private readonly store = new CollectionStore(new CollectionSchema({ types: [], contracts: [] }));
  get setupStatus() { return this.store.schema.setupStatus; }
  private readonly indexCache = new CollectionCache<CollectionIndex>();
  private readonly libraryCache = new CollectionCache<LibraryEntry[]>();
  private readonly manuscriptCache = new CollectionCache<ManuscriptSummary[]>();
  private readonly commentCache = new CollectionCache<true>();
  private readonly annotationCache = new CollectionCache<true>();
  private readonly bodies = new CollectionBodies(() => this.store, (metadata) => this.selectedBodies(metadata));
  private readonly bodyCache = new Map<string, CollectionCache<string>>();
  private readonly dataListeners = new Set<(delta: CollectionDelta) => void>();
  private readonly changedPaths = new Set<string>();
  private changeTimer: ReturnType<typeof setTimeout> | undefined;
  private changeJob: Promise<Result<void>> | undefined;
  private collectionGeneration = 0;
  private reconcileJob: Promise<Result<void>> | undefined;
  private resetRequested = false;
  private disposed = false;
  private readonly files = new Map<string, CollectionFileDescriptor>();
  private readonly listeners = new Set<(paths: readonly string[]) => void>();
  private readonly staleFiles = new Set<string>();
  private readonly lifetime = new AbortController();
  private stopFollowing: (() => void) | undefined;
  annotationFields(path: string, types: readonly string[] = []): Readonly<Record<string, string>> {
    return this.store.annotations.get(path)?.fields ?? this.store.schema.annotationFields(types);
  }

  private async describe(options: { fresh?: boolean } = {}) {
    const generation = this.collectionGeneration;
    const out = await this.connection.describe({ ...options, signal: this.lifetime.signal });
    // Only derive Writer's bindings here; the SDK owns caching and invalidation.
    // A TTL reload must not discard already classified metadata or lazy bodies.
    if (out.ok && generation === this.collectionGeneration && this.store.schema.description !== out.value) {
      this.store.schema = new CollectionSchema(out.value);
    }
    return out;
  }

  constructor(
    private readonly connection: MdbaseConnection<JsonObject>,
    /** Reopens Connect's approval for this collection (to allow the identity permission). */
    private readonly authorize?: () => Promise<{ ok: true } | { ok: false; problem: { code: string; message?: string } }>,
  ) {
    void this.startWatch();
  }

  get collectionName(): string {
    return this.connection.info()?.displayName ?? "Collection";
  }

  get draftNamespace(): string {
    return this.connection.info()?.collectionId ?? "unavailable";
  }

  manuscriptBindings() {
    return this.implementingTypes("manuscript");
  }

  get records() { return this.connection.records; }

  private async startWatch(): Promise<void> {
    const watch = await this.connection.watch({ lifetimeSignal: this.lifetime.signal }, { timeoutMs: 30_000 });
    if (!watch.ok) return;
    this.stopFollowing = this.connection.records.follow(watch.value);
    watch.value.subscribe(
      (change) => {
        let paths: string[];
        switch (change.kind) {
          case "record.created": case "record.updated": case "record.deleted": case "file.changed":
            paths = [change.path]; break;
          case "record.renamed": paths = [...new Set([change.from, change.to])]; break;
          case "file.put": paths = [change.file.path]; break;
          case "file.removed": paths = change.previousPath ? [change.previousPath] : []; break;
          default: paths = []; break;
        }
        const reset = change.kind === "schema.changed" || change.kind === "config.changed"
          || change.kind === "contract.changed" || change.kind === "view.changed"
          || change.kind === "unknown" || change.kind === "gap" || change.kind === "reset"
          || (change.kind === "file.removed" && !change.previousPath);
        if (reset) void this.reconcile();
        else {
          for (const path of paths) { this.changedPaths.add(path); this.bodyCache.delete(path); }
          clearTimeout(this.changeTimer);
          this.changeTimer = setTimeout(() => void this.flushChanges(), 50);
        }
        for (const path of paths) if (this.files.has(path)) this.staleFiles.add(path);
        if (paths.length || reset) for (const l of this.listeners) l(reset ? [] : paths);
      },
      (status) => {
        if (status.state !== "reset_required") return;
        void this.reconcile();
        for (const l of this.listeners) l([]);
      },
      () => {},
    );
  }

  listManuscripts(): Promise<Result<ManuscriptSummary[]>> { return this.manuscriptCache.load(() => this.loadManuscripts()); }

  private async loadManuscripts(): Promise<Result<ManuscriptSummary[]>> {
    const loaded = await this.loadDomain("manuscript");
    return loaded.ok ? ok(this.store.manuscripts) : loaded;
  }

  /** All discovery and watch reads enter the same store, in their raw type view. */
  private async queryRows(input: QueryInput, pageSize = 1_000): Promise<Result<QueryRecord<JsonObject>[]>> {
    const rows: QueryRecord<JsonObject>[] = [];
    for await (const page of this.connection.queryPages(input, { pageSize, signal: this.lifetime.signal })) {
      if (!page.ok) return fail(problemMessage(page));
      rows.push(...page.value.results);
    }
    return ok(rows);
  }

  private async loadDomain(domain: Domain): Promise<Result<true>> {
    const described = await this.describe();
    if (!described.ok) return fail(problemMessage(described));
    const bindings = this.store.schema.bindings(domain, domain === "manuscript");
    if (!bindings.ok) return bindings;
    const generation = this.collectionGeneration;
    const rows = new Map<string, QueryRecord<JsonObject>>();
    for (const binding of bindings.value) {
      const loaded = await this.queryRows({
        types: [binding.name],
        frontmatterMode: domain === "annotation" || domain === "comment" ? "persisted" : "effective",
      }, domain === "manuscript" ? 500 : 1_000);
      if (!loaded.ok) return loaded;
      for (const row of loaded.value) rows.set(row.path, row);
    }
    if (generation !== this.collectionGeneration) return fail("Collection discovery was superseded.");
    this.store.upsert([...rows.values()], true);
    return ok(true);
  }

  /**
   * The collection's manuscript type: the type implementing the manuscript
   * contract (usually the starter `writer-manuscript`), its field names for
   * the contract's fields, and the frontmatter key that declares types.
   */
  private manuscriptType(): Promise<Result<ImplementingType>> {
    return this.implementingTypes("manuscript").then((r) => (r.ok ? ok(r.value[0] as ImplementingType) : r));
  }

  /** The collection's types implementing a contract (the first is the one to create with). */
  private async implementingTypes(domain: Domain): Promise<Result<ImplementingType[]>> {
    const described = await this.describe();
    return described.ok ? this.store.schema.bindings(domain, true) : fail(problemMessage(described));
  }

  async comments(scope?: readonly string[]): Promise<Result<CommentRecord[]>> {
    const refreshed = await this.flushChanges();
    if (!refreshed.ok) return refreshed;
    const generation = this.collectionGeneration;
    const metadata = await this.commentCache.load(() => this.loadDomain("comment"));
    if (!metadata.ok) return metadata;
    if (!this.setupStatus.comments) return ok([]);
    if (scope) {
      const index = await this.index();
      if (!index.ok) return index;
    }
    if (generation !== this.collectionGeneration) return this.comments(scope);
    const bodies = await this.bodies.commentsForScope(scope);
    return generation === this.collectionGeneration ? bodies : this.comments(scope);
  }

  /** Type selection is domain logic; exact-path batching belongs to the SDK. */
  private async selectedBodies(metadata: ReadonlyMap<string, { readonly type: string }>): Promise<Result<QueryRecord<JsonObject>[]>> {
    const byType = new Map<string, string[]>();
    for (const [path, entry] of metadata) {
      if (!byType.has(entry.type)) byType.set(entry.type, []);
      byType.get(entry.type)!.push(path);
    }
    const rows: QueryRecord<JsonObject>[] = [];
    for (const [type, paths] of byType) {
      const loaded = await this.connection.readMany(paths, {
        types: [type], frontmatterMode: "persisted", includeBody: true,
        batchSize: 500, signal: this.lifetime.signal,
      });
      if (!loaded.ok) return fail(problemMessage(loaded));
      if (loaded.value.errors.length) return fail(problemMessage(loaded.value.errors[0]!.failure));
      for (const entry of loaded.value.results) if (entry.status === "found") rows.push(entry.record);
    }
    return ok(rows);
  }

  async createComment(input: NewComment): Promise<Result<CommentRecord>> {
    const types = await this.implementingTypes("comment");
    if (!types.ok) return types;
    const type = types.value[0] as ImplementingType;
    const now = new Date();
    const fields = newCommentFields(input, now, (await this.people()).me?.link);
    const created = await this.connection.create({
      type: type.name,
      path: commentPath(now),
      frontmatter: { [type.typeKey]: type.name, ...toLocal(fields, type.fields) },
      body: input.text.trim() ? `${input.text.trim()}\n` : "",
    });
    if (!created.ok) return fail(problemMessage(created));
    const comment = commentFromRecord(created.value.path, fields, input.text);
    return comment ? ok(comment) : fail("The comment was written but could not be read back.");
  }

  async changeComment(comment: CommentRecord, change: CommentChange): Promise<Result<CommentRecord>> {
    const types = await this.implementingTypes("comment");
    if (!types.ok) return types;
    const current = await this.connection.read({ path: comment.path });
    if (!current.ok) return fail(problemMessage(current));
    const type = types.value.find((t) => current.value.types.includes(t.name)) ?? (types.value[0] as ImplementingType);
    const { fields, body } = changeFields(comment, change, new Date(), (await this.people()).me?.link);
    const updated = await this.connection.update({
      path: comment.path,
      patch: toLocal(fields, type.fields),
      ...(body !== undefined ? { body } : {}),
      ifRevision: current.value.revision,
    });
    if (!updated.ok) return fail(problemMessage(updated));
    const next = commentFromRecord(comment.path, toContract(updated.value.frontmatter, type.fields), body ?? updated.value.body ?? comment.text);
    return next ? ok(next) : fail("The comment was changed but could not be read back.");
  }

  private peoplePromise: Promise<People> | undefined;
  people(options: { fresh?: boolean } = {}): Promise<People> {
    if (options.fresh || !this.peoplePromise) this.peoplePromise = this.loadPeople();
    return this.peoplePromise;
  }

  private async loadPeople(): Promise<People> {
    const directory = await this.connection.people.directory({ members: "omit" });
    if (directory.ok) return peopleFromDirectory(directory.value);
    // Without the account, person names still show; comments go unsigned.
    const signing = signingFromProblem(directory.problem);
    const loaded = await this.loadDomain("person");
    return loaded.ok ? { names: this.store.people, signing } : { ...NO_PEOPLE, signing };
  }

  async reviewIdentityAccess(): Promise<Result<void>> {
    if (!this.authorize) return fail("Writer cannot ask for access here.");
    const outcome = await this.authorize();
    return outcome.ok ? ok(undefined) : fail(outcome.problem.message ?? outcome.problem.code);
  }

  async createManuscript(input: NewManuscript): Promise<Result<string>> {
    const type = await this.manuscriptType();
    if (!type.ok) return type;
    const { name, fields, typeKey } = type.value;
    const frontmatter: JsonObject = { [typeKey]: name, [fields["title"] ?? "title"]: input.title };
    if (fields["template"]) frontmatter[fields["template"]] = input.template;
    if (fields["csl"]) frontmatter[fields["csl"]] = input.style;
    const slug = manuscriptSlug(input.title);
    const sources = input.starter ? await this.library() : undefined;
    const body = manuscriptBody(input.starter, sources?.ok ? sources.value[0]?.key : undefined);
    let last = "";
    for (let n = 1; n <= 20; n++) {
      const created = await this.connection.create({
        type: name,
        path: `manuscripts/${slug}${n > 1 ? `-${n}` : ""}.md`,
        frontmatter,
        body,
      });
      if (created.ok) return ok(created.value.path);
      last = problemMessage(created);
      if (!/exist/i.test(`${created.problem.code} ${last}`)) break;
    }
    return fail(last);
  }

  async adoptManuscript(path: string): Promise<Result<string>> {
    const type = await this.manuscriptType();
    if (!type.ok) return type;
    const { name, fields, typeKey } = type.value;
    const current = await this.connection.read({ path, includeDocument: true });
    if (!current.ok) return fail(problemMessage(current));
    const fm = current.value.frontmatter;
    const titleField = fields["title"] ?? "title";
    const patch: JsonObject = { [typeKey]: withType(fm[typeKey], name) };
    if (typeof fm[titleField] !== "string" || !fm[titleField]) patch[titleField] = titleFromNote(path, current.value.body ?? "");
    const updated = await this.connection.update({ path, patch, ifRevision: current.value.revision });
    return updated.ok ? ok(updated.value.path) : fail(problemMessage(updated));
  }

  async createRecord(path: string, body: string): Promise<Result<string>> {
    let last = "";
    for (let n = 1; n <= 20; n++) {
      const created = await this.connection.create({ path: numberedPath(path, n), frontmatter: {}, body });
      if (created.ok) return ok(created.value.path);
      last = problemMessage(created);
      if (!/exist/i.test(`${created.problem.code} ${last}`)) break;
    }
    return fail(last);
  }

  index(): Promise<Result<CollectionIndex>> { return this.indexCache.load(() => this.loadIndex()); }

  private async loadIndex(): Promise<Result<CollectionIndex>> {
    const generation = this.collectionGeneration;
    const described = await this.describe();
    if (!described.ok) return fail(problemMessage(described));
    const pages = this.connection.queryPages({ frontmatterMode: "persisted" }, {
      pageSize: 1_000, signal: this.lifetime.signal,
    })[Symbol.asyncIterator]();
    try {
      let page = await pages.next();
      while (!page.done) {
        if (!page.value.ok) return fail(problemMessage(page.value));
        if (generation !== this.collectionGeneration) return fail("Collection discovery was superseded.");
        // One-page lookahead hides classification behind transport latency,
        // without parallel cursors or cumulative snapshot allocations.
        const next = pages.next();
        this.store.upsert(page.value.value.results, true);
        page = await next;
      }
    } finally { await pages.return?.(undefined); }
    const files = new Map<string, CollectionFileDescriptor>();
    try {
      for await (const file of this.connection.files.list()) files.set(file.path, file);
    } catch (error) { return fail(errorMessage(error)); }
    if (generation !== this.collectionGeneration) return fail("Collection discovery was superseded.");
    this.store.files([...files.keys()]);
    this.files.clear();
    for (const [path, file] of files) this.files.set(path, file);
    return ok(this.store.index);
  }

  library(): Promise<Result<LibraryEntry[]>> { return this.libraryCache.load(() => this.loadLibrary()); }

  private async loadLibrary(): Promise<Result<LibraryEntry[]>> {
    const loaded = await this.loadDomain("source");
    return loaded.ok ? ok(this.store.library) : loaded;
  }

  async annotationPaths(): Promise<Result<readonly string[]>> {
    const refreshed = await this.flushChanges();
    if (!refreshed.ok) return refreshed;
    const loaded = await this.annotationCache.load(() => this.loadDomain("annotation"));
    return loaded.ok ? ok([...this.store.annotations.keys()]) : loaded;
  }

  async annotationsForSource(path: string): Promise<Result<SourceAnnotation[]>> {
    const identities = await this.annotationPaths();
    if (!identities.ok) return identities;
    const library = await this.library();
    if (!library.ok) return library;
    return this.bodies.annotationsForSource(path);
  }

  readBody(path: string): Promise<Result<string>> {
    let cache = this.bodyCache.get(path);
    if (!cache) this.bodyCache.set(path, cache = new CollectionCache());
    return cache.load(async () => {
      const read = await this.connection.read({ path });
      return read.ok ? ok(read.value.body ?? "") : fail(problemMessage(read));
    });
  }

  async readFile(path: string): Promise<Result<Uint8Array>> {
    const file = this.files.get(path);
    if (!file) return fail(`No file at ${path}.`);
    try {
      if (this.staleFiles.has(path)) {
        for await (const updated of this.connection.files.list({ folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" })) this.files.set(updated.path, updated);
        this.staleFiles.delete(path);
      }
      return ok(await this.connection.files.downloadBytes(this.files.get(path) ?? file));
    } catch (e) {
      return fail(errorMessage(e));
    }
  }

  onCollectionChange(listener: (delta: CollectionDelta) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  private publish(delta: CollectionDelta): void {
    if (!this.disposed) for (const listener of this.dataListeners) listener(delta);
  }

  flushChanges(): Promise<Result<void>> {
    clearTimeout(this.changeTimer);
    if (this.reconcileJob) return this.reconcileJob.then((out) => out.ok ? this.flushChanges() : out);
    if (this.changeJob) return this.changeJob;
    if (!this.changedPaths.size || this.disposed) return Promise.resolve(ok(undefined));
    const job = this.drainChanges();
    this.changeJob = job;
    void job.then(() => { if (this.changeJob === job) this.changeJob = undefined; });
    return job;
  }

  private async drainChanges(): Promise<Result<void>> {
    try {
      while (this.changedPaths.size && !this.disposed) {
        const generation = this.collectionGeneration;
        await Promise.all([
          this.indexCache.pending, this.libraryCache.pending, this.manuscriptCache.pending,
          this.commentCache.pending, this.annotationCache.pending,
        ]);
        if (generation !== this.collectionGeneration) continue;
        const paths = [...this.changedPaths];
        for (const path of paths) this.changedPaths.delete(path);
        try {
          const described = await this.describe();
          if (!described.ok) throw new Error(problemMessage(described));
          const loaded = await this.connection.readMany(paths, {
            frontmatterMode: "both", batchSize: 500, signal: this.lifetime.signal,
          });
          if (!loaded.ok) throw new Error(problemMessage(loaded));
          // A failed batch is not evidence of deletion. Retain all paths for retry.
          if (loaded.value.errors.length) throw new Error(problemMessage(loaded.value.errors[0]!.failure));
          const rows = loaded.value.results.flatMap((entry) => entry.status === "found" ? [entry.record] : []);
          const binaries = await this.changedFiles(paths);
          if (generation !== this.collectionGeneration) continue;
          const present = new Set(rows.map((r) => r.path));
          const upsert = this.store.upsert(rows);
          const removed = this.store.remove(paths.filter((p) => !present.has(p)));
          const files = this.store.files(binaries.present, binaries.removed);
          this.acceptDelta({ ...upsert, ...removed, ...files, paths,
            annotationSources: upsert.annotationSources === null || removed.annotationSources === null
              ? null : [...upsert.annotationSources ?? [], ...removed.annotationSources ?? []],
          });
        } catch (error) { for (const path of paths) this.changedPaths.add(path); throw error; }
      }
      return ok(undefined);
    } catch (error) {
      const message = errorMessage(error);
      this.publish({ paths: [], problem: message });
      return fail(message);
    }
  }

  private acceptDelta(delta: StoreDelta): void {
    if (delta.index && this.indexCache.value) this.indexCache.set(this.store.index);
    if (delta.library && this.libraryCache.value) this.libraryCache.set(this.store.library);
    if (delta.manuscripts && this.manuscriptCache.value) this.manuscriptCache.set(this.store.manuscripts);
    this.bodies.changed(delta);
    // Never promote a still-loading/failed domain from a partial discovery.
    const { index, library, manuscripts, annotations, comments, annotationSources: _sources, ...rest } = delta;
    this.publish({ ...rest,
      ...(index && this.indexCache.value ? { index: this.store.index } : {}),
      ...(library && this.libraryCache.value ? { library: this.store.library } : {}),
      ...(manuscripts && this.manuscriptCache.value ? { manuscripts: this.store.manuscripts } : {}),
      ...(annotations && this.annotationCache.value ? { annotations: true } : {}),
      ...(comments && this.commentCache.value ? { comments: true } : {}),
    });
  }

  private async changedFiles(paths: readonly string[]): Promise<{ present: string[]; removed: string[] }> {
    // No exact binary stat yet: enumerate only the folders containing changed files.
    const folderOf = (p: string) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
    const binaries = paths.filter((p) => !/\.md$/i.test(p));
    const wanted = new Set(binaries), found = new Map<string, CollectionFileDescriptor>();
    for (const folder of new Set(binaries.map(folderOf))) {
      for await (const file of this.connection.files.list({ folder, signal: this.lifetime.signal })) {
        if (wanted.has(file.path)) found.set(file.path, file);
      }
    }
    for (const path of binaries) {
      const file = found.get(path);
      if (file) this.files.set(path, file); else this.files.delete(path);
    }
    return { present: [...found.keys()], removed: binaries.filter((p) => !found.has(p)) };
  }

  reconcile(): Promise<Result<void>> {
    this.resetRequested = true;
    if (this.reconcileJob) return this.reconcileJob;
    const job = (async (): Promise<Result<void>> => {
      if (this.changeJob) await this.changeJob;
      try {
        let result: Result<void> = ok(undefined);
        do { this.resetRequested = false; result = await this.fullReconcile(); } while (this.resetRequested && !this.disposed);
        return result;
      } catch (error) {
        const message = errorMessage(error);
        this.publish({ paths: [], reset: true, problem: message });
        return fail(message);
      }
    })();
    this.reconcileJob = job;
    void job.then(() => { if (this.reconcileJob === job) this.reconcileJob = undefined; }, () => { if (this.reconcileJob === job) this.reconcileJob = undefined; });
    return job;
  }

  private async fullReconcile(): Promise<Result<void>> {
    if (this.disposed) return ok(undefined);
    ++this.collectionGeneration;
    clearTimeout(this.changeTimer);
    this.store.reset();
    this.indexCache.clear();
    this.libraryCache.clear();
    this.manuscriptCache.clear();
    this.commentCache.clear();
    this.annotationCache.clear();
    this.bodies.clear();
    this.bodyCache.clear();
    const described = await this.describe({ fresh: true });
    if (!described.ok) {
      const message = problemMessage(described);
      this.publish({ paths: [], reset: true, problem: message });
      return fail(message);
    }
    const results = await Promise.all([
      this.index(), this.library(), this.listManuscripts(),
      this.annotationCache.load(() => this.loadDomain("annotation")),
      this.commentCache.load(() => this.loadDomain("comment")),
    ]);
    const problem = results.slice(0, 2).find((r) => !r.ok);
    this.publish({ paths: [], reset: true, ...(problem && !problem.ok ? { problem: problem.message } : {}) });
    return problem && !problem.ok ? fail(problem.message) : ok(undefined);
  }

  onExternalChange(listener: (paths: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.changeTimer);
    this.stopFollowing?.();
    this.lifetime.abort();
    this.dataListeners.clear();
    this.listeners.clear();
  }
}
