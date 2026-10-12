// Writer's domain repository over one borrowed public SDK connection. No
// legacy backend facade, SDK runtime/setup engine, copied client or app journal.
import { isMdbaseError, type MdbaseApplicationConnection, type MdbaseClient, type ContractRecordView, type ContractSelector, type Write, type wire } from "@mdbase-dev/sdk";
import type { JsonObject } from "@mdbase-dev/connect";
import { commentFromRecord, type CommentRecord } from "@mdbase-writer/core/comments";
import { CollectionBodies, type WriterBodyRow } from "./bodies.js";
import { CollectionStore, annotationContract, commentContract, domainContract, manuscriptContract, type Binding, type CollectionRow, type CollectionSchema, type Domain } from "./collection.js";
import { changeFields, commentPath, newCommentFields, NO_PEOPLE, peopleFromDirectory, type CommentChange, type NewComment, type People } from "./comments.js";
import { manifestContractDigest, nativeObject, sameDigest, nativeWriteFields, nativeWriterSchema } from "./native-schema.js";
import { NextWriterRecords } from "./next-records.js";
import { fail, manuscriptBody, manuscriptSlug, numberedPath, ok, titleFromNote, type CollectionDelta, type CollectionIndex, type LibraryEntry, type ManuscriptSummary, type NewManuscript, type Result, type SourceAnnotation, type WriterBackend } from "./types.js";

export interface NativeWriterOptions {
  readonly collectionName: string;
  readonly signal: AbortSignal;
  readonly records?: NextWriterRecords;
  /** Reuses the SDK's original authorize gesture, never an app popup engine. */
  readonly authorize?: () => Promise<unknown>;
}
interface NativeMetadata {
  readonly schema: CollectionSchema;
  readonly store: CollectionStore;
  readonly identities: ReadonlyMap<string, {readonly id: string; readonly revision: string}>;
  readonly files: ReadonlyMap<string, wire.FileView>;
  readonly generation: number;
}
const RECONNECT_MIN_MS = 500, RECONNECT_MAX_MS = 30_000;
function unprotected(record: wire.RecordView): boolean {
  return record.state.state === "confirmed" && !record.state.hold && !(record.state.unresolved ?? 0);
}

export class NativeWriterBackend implements WriterBackend {
  readonly kind = "connect";
  readonly collectionName: string;
  readonly draftNamespace: string;
  readonly records: NextWriterRecords;
  // No writeFile: Writer's original declaration allows only files list/read.
  // Upload remains unavailable unless a separately approved declaration changes.
  private readonly client: MdbaseClient;
  private readonly lifetime = new AbortController();
  private readonly signal: AbortSignal;
  private readonly ownedRecords: boolean;
  private watch: ReturnType<MdbaseClient["watchChanges"]>;
  private stopWatchState: () => void = () => {};
  private watchEpoch = 0;
  /** One pending background reconnect at most; its delay doubles to a cap. */
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectDelay = RECONNECT_MIN_MS;
  private readonly external = new Set<(paths: readonly string[]) => void>();
  private readonly collection = new Set<(delta: CollectionDelta) => void>();
  private readonly abort = () => this.dispose();
  private disposed = false;
  private generation = 0;
  private cached: NativeMetadata | undefined;
  private metadataJob: Promise<NativeMetadata> | undefined;
  private peopleJob: Promise<People> | undefined;
  private writing = false;
  /** Original public SDK MID only; SDK owns its durable journal/receipt engine. */
  private unresolvedMutation: string | undefined;

  constructor(private readonly connection: MdbaseApplicationConnection, private readonly options: NativeWriterOptions) {
    this.client = connection.records;
    if (connection.id !== this.client.collection || connection.files !== this.client.files) throw new Error("Writer requires its original SDK collection and files client.");
    this.collectionName = options.collectionName;
    this.draftNamespace = this.client.collection;
    this.signal = AbortSignal.any([options.signal, this.lifetime.signal]);
    this.ownedRecords = !options.records;
    this.records = options.records ?? new NextWriterRecords(this.client, this.signal, () => connection.isCurrent());
    this.watch = this.startWatch();
    this.signal.addEventListener("abort", this.abort, {once: true});
    if (this.signal.aborted) this.dispose();
  }
  get setupStatus() {return this.cached?.schema.setupStatus;}
  private startWatch(reconnecting = false, background = false): ReturnType<MdbaseClient["watchChanges"]> {
    const epoch = ++this.watchEpoch;
    // A failed replacement does not invalidate again (no recursive reload
    // loop); it schedules one bounded, backed-off reconnect instead.
    let notifyFailure = !reconnecting;
    const current = () => !this.disposed && epoch === this.watchEpoch;
    const watch = this.client.watchChanges(undefined, batch => {
      if (current()) this.invalidate(batch.reset ? [] : batch.changes.map(change => change.path));
    });
    const ended = () => {
      if (notifyFailure) this.invalidate([]);
      notifyFailure = false;
      this.scheduleReconnect();
    };
    this.stopWatchState = watch.subscribe(state => {
      if (!current()) return;
      if (state === "active") {
        this.reconnectDelay = RECONNECT_MIN_MS; notifyFailure = true;
        // Changes made while disconnected were never delivered: reload.
        if (background) {background = false; this.invalidate([]);}
      }
      if (state === "stale" || state === "failed" || state === "closed") ended();
    });
    void watch.ready.catch(() => {if (current()) ended();});
    return watch;
  }
  private ended(watch: ReturnType<MdbaseClient["watchChanges"]>): boolean {
    return watch.state === "stale" || watch.state === "failed" || watch.state === "closed";
  }
  /** Replace our own ended handle: fence its callbacks, retire it, start one. */
  private replaceWatch(background: boolean): void {
    clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined;
    ++this.watchEpoch;
    this.stopWatchState(); this.watch();
    this.watch = this.startWatch(true, background);
  }
  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer !== undefined) return;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (this.disposed || !this.connection.isCurrent() || !this.ended(this.watch)) return;
      this.replaceWatch(true);
    }, delay);
  }
  private discoveryWatch(): ReturnType<MdbaseClient["watchChanges"]> {
    if (this.ended(this.watch)) this.replaceWatch(false);
    return this.watch;
  }
  private check(generation?: number): void {
    this.signal.throwIfAborted();
    if (this.disposed || !this.connection.isCurrent()) throw new Error("Writer's collection has changed.");
    if (generation !== undefined && generation !== this.generation) throw new Error("Writer's collection discovery has changed. Retry the read.");
  }
  private async safely<T>(operation: () => Promise<T>): Promise<Result<T>> {
    try {this.check(); const value = await operation(); this.check(); return ok(value);}
    catch (error) {
      return fail(this.signal.aborted || this.disposed ? "Writer's collection view has closed."
        : isMdbaseError(error) ? `The native collection operation could not complete (${error.code}).`
        : error instanceof Error && error.message.startsWith("Writer") ? error.message : "Writer could not read or confirm this collection operation.");
    }
  }
  private async safelyResult<T>(operation: () => Promise<Result<T>>): Promise<Result<T>> {
    const result = await this.safely(operation);
    return result.ok ? result.value : result;
  }
  private invalidate(paths: readonly string[]): void {
    if (this.disposed) return;
    ++this.generation; this.cached = undefined; this.peopleJob = undefined;
    for (const listener of this.external) listener(paths);
    for (const listener of this.collection) listener({paths, reset: true});
  }
  private metadata(): Promise<NativeMetadata> {
    this.check();
    if (this.cached && this.watch.state === "active") return Promise.resolve(this.cached);
    this.cached = undefined;
    if (this.metadataJob) return this.metadataJob;
    const job = this.loadMetadata(); this.metadataJob = job;
    void job.then(() => {if (this.metadataJob === job) this.metadataJob = undefined;}, () => {if (this.metadataJob === job) this.metadataJob = undefined;});
    return job;
  }
  private async loadMetadata(): Promise<NativeMetadata> {
    const watch = this.discoveryWatch();
    await watch.ready; this.check();
    const generation = this.generation;
    if (watch !== this.watch || watch.state !== "active") throw new Error("Writer's collection watch needs reconnection.");
    const catalog = await this.client.describe(this.signal); this.check(generation);
    const schema = nativeWriterSchema(catalog);
    const store = new CollectionStore(schema);
    const rows = new Map<string, CollectionRow>();
    const identities = new Map<string, {id: string; revision: string}>();
    const ids = new Set<string>();
    const recordCursors = new Set<string>();
    let asOf: number | undefined;
    let complete = false;
    for await (const page of this.client.pages({limit: 500}, {effective: true}, this.signal)) {
      this.check(generation);
      if (asOf !== undefined && asOf !== page.asOf) throw new Error("Writer's native query snapshot changed.");
      asOf = page.asOf;
      if (page.cursor) {
        if (recordCursors.has(page.cursor)) throw new Error("Writer's native record cursor repeated.");
        recordCursors.add(page.cursor);
      }
      for (const record of page.records) {
        if (identities.has(record.path) || ids.has(record.id)) throw new Error("Writer's native query repeated a record identity.");
        identities.set(record.path, {id: record.id, revision: record.revision}); ids.add(record.id);
        rows.set(record.id, {path: record.path, types: record.types,
          ...(record.mtime !== undefined ? {file: {mtime: new Date(record.mtime).toISOString()}} : {})});
      }
      complete = page.complete && !page.cursor;
    }
    if (!complete || asOf === undefined) throw new Error("Writer's native query did not return a complete snapshot.");
    await this.projectMetadata(catalog, schema, rows, identities, asOf, generation);
    store.upsert([...rows.values()], true);
    const files = new Map<string, wire.FileView>();
    const fileIds = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.connection.files.listPage({limit: 500, ...(cursor ? {cursor} : {}), signal: this.signal});
      this.check(generation);
      for (const file of page.files) {
        if (files.has(file.path) || fileIds.has(file.id)) throw new Error("Writer's file listing repeated an identity.");
        files.set(file.path, file); fileIds.add(file.id);
      }
      cursor = page.cursor;
      if (cursor) {
        if (cursors.has(cursor)) throw new Error("Writer's file cursor repeated.");
        cursors.add(cursor);
      } else if (!page.complete) throw new Error("Writer's file listing is incomplete.");
    } while (cursor);
    store.files([...files.keys()]);
    this.check(generation);
    if (watch !== this.watch || watch.state !== "active") throw new Error("Writer's collection watch needs reconnection.");
    return this.cached = {schema, store, identities, files, generation};
  }
  private async projectMetadata(catalog: wire.DescribeResult, schema: CollectionSchema, rows: Map<string, CollectionRow>, identities: ReadonlyMap<string, {id: string; revision: string}>, asOf: number, generation: number): Promise<void> {
    for (const domain of ["manuscript", "source", "annotation", "comment", "person"] as const) {
      const selected = new Map([...rows].filter(([, row]) => schema.roles(row.types).get(domain)?.active));
      if (!selected.size) continue;
      const contract = domainContract(domain);
      const declared = catalog.contracts.find(candidate => candidate.id === contract.id && candidate.version === contract.version);
      if (!declared) throw new Error("Writer's metadata lost its exact contract.");
      const seen = new Set<string>();
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const result = await this.client.queryContract(contract, {pageSize: 128, ...(cursor ? {cursor} : {}), signal: this.signal}); this.check(generation);
        if (!sameDigest(result.contractDigest, declared.digest) || result.page.asOf !== asOf) throw new Error("Writer's contract metadata snapshot or digest changed.");
        const witnesses = new Map(result.page.records.map(record => [record.id, record]));
        if (witnesses.size !== result.page.records.length) throw new Error("Writer's contract query repeated a record identity.");
        for (const projected of result.records) {
          const row = selected.get(projected.id);
          const witness = witnesses.get(projected.id);
          const identity = row && identities.get(row.path);
          if (!row || !witness || !identity || witness.path !== row.path || witness.revision !== identity.revision || seen.has(projected.id)) throw new Error("Writer's contract metadata identity changed or repeated.");
          const binding = schema.roles(row.types).get(domain);
          const implementations = projected.implementations.filter(candidate => candidate.typeName === binding?.name);
          const implementation = implementations[0];
          if (implementations.length !== 1 || !implementation) throw new Error("Writer's contract metadata projection is ambiguous.");
          seen.add(projected.id);
          // One invalid record stays listed without its projected fields;
          // it never blocks the rest of the collection.
          if (implementation.issues.some(issue => issue.severity === "error")) continue;
          rows.set(projected.id, {...row, contractFields: {...row.contractFields, [domain]: nativeObject(implementation.fields)}});
        }
        cursor = result.page.cursor;
        if (cursor) {
          if (cursors.has(cursor)) throw new Error("Writer's contract metadata cursor repeated.");
          cursors.add(cursor);
        } else if (!result.page.complete) throw new Error("Writer's contract metadata query is incomplete.");
      } while (cursor);
      if (seen.size !== selected.size) throw new Error("Writer's contract metadata omitted an original record.");
    }
  }
  manuscriptBindings(): Promise<Result<readonly Binding[]>> {return this.safely(async () => this.bindingList((await this.metadata()).schema, "manuscript"));}
  private bindingList(schema: CollectionSchema, domain: Domain): Binding[] {
    const found = schema.bindings(domain, true);
    if (!found.ok) throw new Error(found.message);
    return found.value;
  }
  private async binding(domain: Domain): Promise<Binding> {
    const first = this.bindingList((await this.metadata()).schema, domain)[0];
    if (!first) throw new Error("Writer has no native type for this operation.");
    return first;
  }
  listManuscripts(): Promise<Result<ManuscriptSummary[]>> {return this.safely(async () => this.available(await this.metadata(), "manuscript").store.manuscripts);}
  /** Fails with plain copy when every Writer type for the domain is unusable. */
  private available(metadata: NativeMetadata, domain: Domain): NativeMetadata {
    const message = metadata.schema.unavailableMessage(domain);
    if (message) throw new Error(message);
    return metadata;
  }
  index(): Promise<Result<CollectionIndex>> {return this.safely(async () => (await this.metadata()).store.index);}
  library(): Promise<Result<LibraryEntry[]>> {return this.safely(async () => (await this.metadata()).store.library);}
  annotationPaths(): Promise<Result<readonly string[]>> {return this.safely(async () => [...(await this.metadata()).store.annotations.keys()]);}
  annotationFields(path: string, types: readonly string[] = []): Readonly<Record<string, string>> {
    return this.cached?.store.annotations.get(path)?.fields ?? this.cached?.schema.annotationFields(types) ?? {};
  }
  private bodies(metadata: NativeMetadata): CollectionBodies {
    return new CollectionBodies(() => metadata.store, selected => this.safely(async () => {
      const rows: WriterBodyRow[] = [];
      for (const [path, entry] of selected) {
        const identity = metadata.identities.get(path);
        if (!identity) throw new Error("Writer lost the original record identity.");
        const record = await this.client.get(identity.id, {body: true}, this.signal); this.check(metadata.generation);
        if (record.id !== identity.id || record.path !== path || record.revision !== identity.revision || !record.types.includes(entry.type) || !unprotected(record)) throw new Error("Writer's selected record changed or is protected.");
        const contract = metadata.store.comments.has(path) ? commentContract : annotationContract;
        const projected = await this.contractRecord(record, {...contract, type: entry.type}); this.check(metadata.generation);
        rows.push({path: record.path, types: record.types, contractFields: nativeObject(projected.fields), body: record.body ?? ""});
      }
      return rows;
    }));
  }
  comments(scope?: readonly string[]): Promise<Result<CommentRecord[]>> {
    return this.safelyResult(async () => {
      const metadata = this.available(await this.metadata(), "comment");
      const result = await this.bodies(metadata).commentsForScope(scope); this.check(metadata.generation);
      return result;
    });
  }
  annotationsForSource(path: string): Promise<Result<SourceAnnotation[]>> {
    return this.safelyResult(async () => {
      const metadata = await this.metadata();
      const result = await this.bodies(metadata).annotationsForSource(path); this.check(metadata.generation);
      return result;
    });
  }
  readBody(path: string): Promise<Result<string>> {
    return this.safely(async () => {
      const metadata = await this.metadata(); const original = metadata.identities.get(path);
      if (!original) throw new Error("Writer cannot find this record in its native index.");
      const record = await this.client.get(original.id, {body: true}, this.signal); this.check(metadata.generation);
      if (record.id !== original.id || record.path !== path || record.revision !== original.revision || !unprotected(record)) throw new Error("Writer's record changed or is protected.");
      return record.body ?? "";
    });
  }
  readFile(path: string): Promise<Result<Uint8Array>> {
    return this.safely(async () => {
      const metadata = await this.metadata(); const original = metadata.files.get(path);
      if (!original) throw new Error("Writer cannot find this file in its native index.");
      const seen = await this.connection.files.get(original.id, this.signal); this.check(metadata.generation);
      if (seen.id !== original.id || seen.path !== path || seen.digest !== original.digest || seen.hold || seen.state === "pending_upload" || seen.confirmedSeq <= 0) throw new Error("Writer's file changed or is protected.");
      const bytes = await this.connection.files.download(seen, {signal: this.signal}); this.check(metadata.generation);
      const current = await this.connection.files.get(original.id, this.signal); this.check(metadata.generation);
      if (current.id !== original.id || current.digest !== seen.digest || current.path !== path || current.hold || current.state === "pending_upload" || current.confirmedSeq <= 0 || bytes.byteLength !== current.size) throw new Error("Writer's downloaded file changed or is protected.");
      return bytes;
    });
  }
  people(options: {fresh?: boolean} = {}): Promise<People> {
    if (!this.peopleJob || options.fresh) this.peopleJob = this.loadPeople();
    return this.peopleJob;
  }
  private async loadPeople(): Promise<People> {
    try {
      this.check();
      const directory = await this.connection.people.directory({members: "omit", signal: this.signal}); this.check();
      return peopleFromDirectory(directory);
    } catch (error) {
      // Names only, never a substitute account/author or guessed identity.
      try {const names = (await this.metadata()).store.people; this.check(); return {names, signing: {kind: "unavailable", reason: "Writer could not check the account's person record."}};}
      catch {return {...NO_PEOPLE, signing: isMdbaseError(error) && error.code === "forbidden" ? {kind: "not-approved"} : {kind: "unavailable", reason: "Writer could not check the account's person record."}};}
    }
  }
  reviewIdentityAccess(): Promise<Result<void>> {
    return this.safely(async () => {if (!this.options.authorize) throw new Error("Writer cannot request identity access here."); await this.options.authorize(); this.check(); this.peopleJob = undefined;});
  }
  private async write<T>(operation: () => Promise<T>): Promise<Result<T>> {
    if (this.writing) return fail("Writer is still confirming the original operation.");
    this.writing = true;
    try {
      return await this.safely(async () => {
        // A lost submit result never admits a fresh retry. Reconcile the same
        // captured MID through SDK receipt/read APIs; this click does no write.
        if (this.unresolvedMutation) {
          const receipt = await this.client.awaitReceipt(this.unresolvedMutation, 5_000, this.signal); this.check();
          if (receipt.mutation !== this.unresolvedMutation) throw new Error("Writer lost the original receipt identity.");
          if (receipt.state === "rejected") {
            this.unresolvedMutation = undefined;
            throw new Error("Writer's original operation was rejected. Review it before starting another.");
          }
          await this.recovered(this.unresolvedMutation, receipt);
          this.unresolvedMutation = undefined;
          throw new Error("Writer recovered the original operation. Review it before starting another.");
        }
        // Recover SDK-retained mutations from earlier owners/reloads as well.
        const pending = await this.client.pendingWrites(this.signal); this.check();
        for (const original of pending) {
          const receipt = await this.client.awaitReceipt(original.receipt.mutation, 5_000, this.signal); this.check();
          await this.recovered(original.receipt.mutation, receipt);
        }
        if (pending.length) throw new Error("Writer recovered an earlier operation. Review it before starting another.");
        return operation();
      });
    } finally {this.writing = false;}
  }
  private async recovered(mutationId: string, receipt: wire.Receipt): Promise<void> {
    if (receipt.mutation !== mutationId || receipt.state !== "confirmed" || !receipt.records?.length) throw new Error("Writer must recover the original operation before starting another.");
    for (const witnessed of receipt.records) {
      const current = await this.client.get(witnessed.id, {document: true}, this.signal); this.check();
      if (!unprotected(current) || current.id !== witnessed.id || current.path !== witnessed.path
        || (witnessed.state.state === "confirmed" && current.revision !== witnessed.revision)) throw new Error("Writer's original operation is protected or changed.");
    }
  }
  private async availablePath(path: string): Promise<string> {
    for (let n = 1; n <= 20; n++) {
      const target = numberedPath(path, n);
      const found = await this.client.find({path: target}, undefined, this.signal); this.check();
      if (!found) return target;
    }
    throw new Error("Writer could not find an unused path.");
  }
  private async nativeWrite(start: (mutationId: string) => Promise<Write>): Promise<Write> {
    const mutationId = crypto.randomUUID();
    this.unresolvedMutation = mutationId;
    try {
      const write = await start(mutationId); this.check();
      if (write.mutationId !== mutationId) throw new Error("Writer lost the original mutation identity.");
      return write;
    } catch (error) {
      if (isMdbaseError(error) && error.mutationId) {
        if (error.mutationId !== mutationId) throw new Error("Writer lost the original mutation identity.", {cause: error});
        this.unresolvedMutation = error.mutationId;
      }
      // Retain the captured original even for an untyped lost transport reply.
      // A receipt lookup, never a new submit, resolves the next user action.
      throw error;
    }
  }
  private async contractRecord(original: wire.RecordView, contract: ContractSelector): Promise<ContractRecordView> {
    const projected = await this.client.getContract(original.id, contract, this.signal); this.check();
    const expected = (await this.metadata()).schema.description.contracts.find(candidate => candidate.id === contract.id);
    const digest = manifestContractDigest(contract.id, contract.version);
    if (!expected || projected.id !== original.id || projected.path !== original.path || projected.revision !== original.revision
      || projected.contract.id !== contract.id || projected.contract.version !== contract.version || projected.contract.type !== contract.type
      || (digest !== undefined && !sameDigest(projected.contract.digest, digest))) throw new Error("Writer's contract record binding changed.");
    const current = await this.client.get(original.id, {body: true, document: true}, this.signal); this.check();
    if (!unprotected(current) || current.id !== original.id || current.path !== original.path || current.revision !== original.revision) throw new Error("Writer's contract record changed or is protected.");
    return projected;
  }
  private async confirmed(write: Write, id: string, contract?: ContractSelector): Promise<wire.RecordView> {
    await write.confirmed; this.check();
    if (write.receipt.mutation !== write.mutationId || write.receipt.state !== "confirmed") throw new Error("Writer lost the original confirmed receipt.");
    // A confirmed receipt may carry no records, so `write.records` can still be the
    // optimistic (pending) view from submit. It proves identity and path; the
    // confirmed read below proves protection and the current revision.
    const witnessed = write.records.find(record => record.id === id);
    if (!witnessed) throw new Error("Writer's original receipt did not name the record.");
    const current = await this.client.get(id, {body: true, document: true}, this.signal); this.check();
    if (!unprotected(current) || current.id !== id || current.path !== witnessed.path
      || (witnessed.state.state === "confirmed" && current.revision !== witnessed.revision)) throw new Error("Writer's confirmed record changed or is protected.");
    if (contract) await this.contractRecord(current, contract);
    if (this.unresolvedMutation === write.mutationId) this.unresolvedMutation = undefined;
    return current;
  }
  private async create(path: string, body: string, frontmatter: JsonObject, contract?: ContractSelector): Promise<wire.RecordView> {
    const target = await this.availablePath(path); this.check();
    const id = crypto.randomUUID();
    // Exactly one submit. A taken path/unknown outcome is not a fresh retry.
    const fields = nativeWriteFields(frontmatter);
    const write = await this.nativeWrite(mutationId => this.client.create({id, path: target, body, frontmatter: fields, ...(contract ? {contract} : {})}, {mutationId, signal: this.signal, include: {body: true, document: true}}));
    this.check(); return this.confirmed(write, id, contract);
  }
  createManuscript(input: NewManuscript): Promise<Result<string>> {
    return this.write(async () => {
      const binding = await this.binding("manuscript");
      const library = input.starter ? (await this.metadata()).store.library : [];
      const body = manuscriptBody(input.starter, library[0]?.key);
      const frontmatter = {title: input.title, template: input.template, csl: input.style};
      const created = await this.create(`manuscripts/${manuscriptSlug(input.title)}.md`, body, frontmatter, {...manuscriptContract, type: binding.name});
      if (created.body !== body) throw new Error("Writer's manuscript readback differs from the original operation.");
      return created.path;
    });
  }
  createRecord(path: string, body: string): Promise<Result<string>> {
    return this.write(async () => {const created = await this.create(path, body, {}); if (created.body !== body) throw new Error("Writer's record readback differs from the original operation."); return created.path;});
  }
  adoptManuscript(path: string): Promise<Result<string>> {
    return this.write(async () => {
      const binding = await this.binding("manuscript");
      const original = await this.client.get({path}, {body: true, document: true}, this.signal); this.check();
      if (!unprotected(original) || original.document === undefined) throw new Error("Writer's note is protected or lacks its full source.");
      const contract = {...manuscriptContract, type: binding.name};
      const patch = {title: titleFromNote(path, original.body ?? "")};
      const write = await this.nativeWrite(mutationId => this.client.update(original, {contract, promote: true, patch, ifRevision: original.revision}, {mutationId, signal: this.signal, include: {body: true, document: true}}));
      const current = await this.confirmed(write, original.id, {...manuscriptContract, type: binding.name});
      if (current.body !== original.body || !current.types.includes(binding.name)) throw new Error("Writer's adopted note did not confirm the original content and type.");
      return current.path;
    });
  }
  createComment(input: NewComment): Promise<Result<CommentRecord>> {
    return this.write(async () => {
      const binding = await this.binding("comment"); const now = new Date();
      const fields = newCommentFields(input, now, (await this.people()).me?.link); this.check();
      const body = input.text.trim() ? `${input.text.trim()}\n` : "";
      const contract = {...commentContract, type: binding.name};
      const current = await this.create(commentPath(now), body, fields, contract);
      const projected = await this.contractRecord(current, contract);
      const comment = commentFromRecord(current.path, nativeObject(projected.fields), current.body ?? "");
      if (!comment || current.body !== body) throw new Error("Writer's comment could not be confirmed from its native readback.");
      return comment;
    });
  }
  changeComment(comment: CommentRecord, change: CommentChange): Promise<Result<CommentRecord>> {
    return this.write(async () => {
      const metadata = await this.metadata(); const identity = metadata.identities.get(comment.path);
      if (!identity) throw new Error("Writer lost the original comment identity.");
      const original = await this.client.get(identity.id, {body: true, document: true}, this.signal); this.check();
      if (!unprotected(original) || original.document === undefined || original.path !== comment.path) throw new Error("Writer's original comment is protected or has moved.");
      const binding = this.bindingList(metadata.schema, "comment").find(candidate => original.types.includes(candidate.name));
      if (!binding) throw new Error("Writer's comment lost its native contract binding.");
      const contract = {...commentContract, type: binding.name};
      const projected = await this.contractRecord(original, contract);
      const currentComment = commentFromRecord(original.path, nativeObject(projected.fields), original.body ?? "");
      if (!currentComment || JSON.stringify(currentComment) !== JSON.stringify(comment)) throw new Error("Writer's comment changed before this operation.");
      const {fields, body} = changeFields(currentComment, change, new Date(), (await this.people()).me?.link); this.check();
      const patch = nativeWriteFields(fields);
      const write = await this.nativeWrite(mutationId => this.client.update(original, {contract, patch, ...(body !== undefined ? {body} : {}), ifRevision: original.revision}, {mutationId, signal: this.signal, include: {body: true, document: true}}));
      const current = await this.confirmed(write, original.id, contract);
      const nextView = await this.contractRecord(current, contract);
      const next = commentFromRecord(current.path, nativeObject(nextView.fields), current.body ?? "");
      if (!next) throw new Error("Writer's changed comment could not be confirmed from native readback.");
      return next;
    });
  }
  onExternalChange(listener: (paths: readonly string[]) => void): () => void {this.external.add(listener); return () => {this.external.delete(listener);};}
  onCollectionChange(listener: (delta: CollectionDelta) => void): () => void {this.collection.add(listener); return () => {this.collection.delete(listener);};}
  flushChanges(): Promise<Result<void>> {return this.safely(async () => {await this.metadata();});}
  reconcile(): Promise<Result<void>> {this.invalidate([]); return this.flushChanges();}
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; ++this.watchEpoch; clearTimeout(this.reconnectTimer); this.reconnectTimer = undefined;
    this.signal.removeEventListener("abort", this.abort); this.stopWatchState(); this.watch();
    this.lifetime.abort(); if (this.ownedRecords) this.records.dispose();
    this.external.clear(); this.collection.clear(); this.cached = undefined;
  }
}
