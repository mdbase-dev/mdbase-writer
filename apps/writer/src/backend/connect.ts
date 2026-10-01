// The writer on a real collection through mdbase connect.
import { PERSON_CONTRACT, type CollectionFileDescriptor, type JsonObject, type QueryRecord, type MdbaseConnection } from "@mdbase-dev/connect";
import { commentFromRecord, linkPath, type CommentRecord } from "@mdbase-writer/core/comments";
import { annotationSourceLink } from "@mdbase-writer/core/annotations";
import { PathIndex, resolveLinkTarget } from "@mdbase-writer/core/records";
import { CollectionCache } from "./cache.js";
import { errorMessage } from "../async.js";

import {
  changeFields,
  commentPath,
  newCommentFields,
  NO_PEOPLE,
  peopleFromDirectory,
  personKey,
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
  libraryEntry,
  manuscriptSlug,
  numberedPath,
  ok,
  sourceAnnotation,
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

export const manuscriptContract = { id: "dev.mdbase.writer.manuscript", version: "1.0.0-beta.2" } as const;
export const sourceContract = { id: "dev.mdbase.reader.source", version: "1.0.0-beta.1" } as const;
export const annotationContract = { id: "dev.mdbase.reader.annotation", version: "1.0.0-beta.1" } as const;
export const commentContract = { id: "mdbase.comment", version: "1.0.0" } as const;

/** A collection type implementing a contract: its name, its field for each contract field, and the key that declares types. */
interface ImplementingType {
  readonly name: string;
  readonly fields: Record<string, string>;
  readonly typeKey: string;
}

interface AnnotationMetadata {
  readonly path: string;
  readonly type: string;
  readonly source: string;
  readonly fields: Readonly<Record<string, string>>;
}

interface CommentMetadata { readonly type: string; readonly fields: Readonly<Record<string, string>>; readonly comment: CommentRecord }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const problemMessage = (outcome: { ok: false; problem: { message?: string; code: string } }) => outcome.problem.message ?? outcome.problem.code;

export class ConnectBackend implements WriterBackend {
  readonly kind = "connect";
  setupStatus: { sources: boolean; annotations: boolean; comments: boolean } | undefined;
  private readonly indexCache = new CollectionCache<CollectionIndex>();
  private readonly libraryCache = new CollectionCache<LibraryEntry[]>();
  private readonly manuscriptCache = new CollectionCache<ManuscriptSummary[]>();
  private readonly commentCache = new CollectionCache<Map<string, CommentMetadata>>();
  private readonly commentBodies = new Map<string, CommentRecord>();
  private readonly bodyCache = new Map<string, Promise<Result<string>>>();
  private recordSet = new Set<string>();
  private noteSet = new Set<string>();
  private readonly dataListeners = new Set<(delta: CollectionDelta) => void>();
  private readonly changedPaths = new Set<string>();
  private changeTimer: ReturnType<typeof setTimeout> | undefined;
  private changeJob: Promise<Result<void>> | undefined;
  private collectionGeneration = 0;
  private reconcileJob: Promise<Result<void>> | undefined;
  private resetRequested = false;
  private disposed = false;
  private commentPathsIndex: { paths: readonly string[]; index: PathIndex } | undefined;
  private readonly files = new Map<string, CollectionFileDescriptor>();
  private readonly listeners = new Set<(paths: readonly string[]) => void>();
  private readonly staleFiles = new Set<string>();
  private readonly lifetime = new AbortController();
  private stopFollowing: (() => void) | undefined;
  private description: ReturnType<MdbaseConnection<JsonObject>["describe"]> | undefined;
  private schemaPaths: ReadonlySet<string> = new Set(["mdbase.yaml"]);
  private schemaFolders: readonly string[] = ["_types", "_contracts"];
  private annotationIndex: Promise<Result<Map<string, AnnotationMetadata>>> | undefined;
  private annotationRows = new Map<string, AnnotationMetadata>();
  private annotationTypes: ImplementingType[] = [];
  private readonly annotationSources = new Map<string, Promise<Result<SourceAnnotation[]>>>();
  private sourcePaths = new PathIndex([]);
  private libraryGeneration = 0;
  private annotationGroups: { metadata: Map<string, AnnotationMetadata>; sources: PathIndex; groups: Map<string, Map<string, AnnotationMetadata>> } | undefined;

  annotationFields(path: string, types: readonly string[] = []): Readonly<Record<string, string>> {
    return this.annotationRows.get(path)?.fields ?? this.annotationTypes.find((t) => types.includes(t.name))?.fields ?? {};
  }

  private invalidateAnnotations(): void {
    this.annotationIndex = undefined;
    this.annotationRows = new Map();
    this.annotationTypes = [];
    this.annotationSources.clear();
    this.annotationGroups = undefined;
  }

  private describe(): ReturnType<MdbaseConnection<JsonObject>["describe"]> {
    if (this.description) return this.description;
    const job = this.connection.describe().then((out) => {
      if (this.description !== job) return out;
      if (!out.ok) this.description = undefined;
      else {
        const has = (id: string, starter: string) => out.value.contracts.some((c) => c.id === id) || out.value.types.some((t) => t.name === starter);
        this.setupStatus = { sources: has(sourceContract.id, "reader-source"), annotations: has(annotationContract.id, "reader-annotation"), comments: out.value.contracts.some((c) => c.id === commentContract.id && c.implementations.length > 0) };
        this.schemaPaths = new Set(["mdbase.yaml", ...out.value.types.flatMap((t) => t.path ? [t.path] : []), ...out.value.contracts.flatMap((c) => c.implementations.flatMap((i) => i.typePath ? [i.typePath] : []))]);
        const settings = out.value.configuration?.["settings"] as JsonObject | undefined;
        this.schemaFolders = [settings?.["types_folder"] ?? "_types", settings?.["contracts_folder"] ?? "_contracts"].filter((p): p is string => typeof p === "string" && !!p).map((p) => p.replace(/^\.\//, "").replace(/\/+$/, ""));
      }
      return out;
    }).catch((error: unknown) => { if (this.description === job) this.description = undefined; throw error; });
    this.description = job;
    return job;
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
    return this.implementingTypes(manuscriptContract.id, "manuscripts");
  }

  get records() { return this.connection.records; }

  private async startWatch(): Promise<void> {
    const watch = await this.connection.watch({ lifetimeSignal: this.lifetime.signal }, { timeoutMs: 30_000 });
    if (!watch.ok) return;
    this.stopFollowing = this.connection.records.follow(watch.value);
    watch.value.subscribe(
      (change) => {
        const paths = [...new Set([change.payload["path"], change.payload["from"], change.payload["to"]].filter((p): p is string => typeof p === "string"))];
        const schemaChanged = /type|contract|configuration/.test(change.type) || paths.some((p) => this.schemaPaths.has(p) || this.schemaFolders.some((folder) => p.startsWith(`${folder}/`)));
        if (schemaChanged) void this.reconcile();
        else {
          for (const path of paths) { this.changedPaths.add(path); this.bodyCache.delete(path); }
          clearTimeout(this.changeTimer);
          this.changeTimer = setTimeout(() => void this.flushChanges(), 50);
        }
        for (const path of paths) if (this.files.has(path)) this.staleFiles.add(path);
        if (paths.length || schemaChanged) for (const l of this.listeners) l(schemaChanged ? [] : paths);
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
    const out: ManuscriptSummary[] = [];
    for await (const page of this.connection.queryPages({ contract: manuscriptContract, frontmatterMode: "effective" }, { pageSize: 500 })) {
      if (!page.ok) return fail(problemMessage(page));
      for (const r of page.value.results) {
        const fm = r.effectiveFrontmatter ?? r.frontmatter ?? {};
        out.push({
          path: r.path,
          title: typeof fm["title"] === "string" ? fm["title"] : r.path,
          ...(typeof fm["template"] === "string" ? { template: fm["template"] } : {}),
          ...(typeof fm["csl"] === "string" ? { style: fm["csl"] } : {}),
          ...(r.file.mtime ? { modified: r.file.mtime } : {}),
        });
      }
    }
    // Titles are useful immediately. Home computes word counts in the background.
    return ok(out.sort((a, b) => a.title.localeCompare(b.title)));
  }

  /**
   * The collection's manuscript type: the type implementing the manuscript
   * contract (usually the starter `writer-manuscript`), its field names for
   * the contract's fields, and the frontmatter key that declares types.
   */
  private manuscriptType(): Promise<Result<ImplementingType>> {
    return this.implementingTypes(manuscriptContract.id, "manuscripts").then((r) => (r.ok ? ok(r.value[0] as ImplementingType) : r));
  }

  /** The collection's types implementing a contract (the first is the one to create with). */
  private async implementingTypes(contractId: string, what: string): Promise<Result<ImplementingType[]>> {
    const described = await this.describe();
    if (!described.ok) return fail(problemMessage(described));
    const implementations = described.value.contracts.find((c) => c.id === contractId)?.implementations ?? [];
    if (!implementations.length) return fail(`This collection has no type for ${what}. Set it up again from mdbase connect.`);
    const settings = described.value.configuration?.["settings"] as { explicit_type_keys?: unknown } | undefined;
    const keys = settings?.explicit_type_keys;
    // With explicit type keys turned off, the starter type still matches on `type`.
    const typeKey = Array.isArray(keys) && typeof keys[0] === "string" ? keys[0] : "type";
    return ok(implementations.map((i) => ({ name: i.typeName, fields: i.fields, typeKey })));
  }

  private async commentMetadata(): Promise<Result<Map<string, CommentMetadata>>> {
    return this.commentCache.load(async () => {
      const described = await this.describe();
      if (!described.ok) return fail(problemMessage(described));
      if (this.setupStatus?.comments === false) return ok(new Map());
      const types = await this.implementingTypes(commentContract.id, "comments");
      if (!types.ok) return types;
      const out = new Map<string, CommentMetadata>();
      for (const type of types.value) for await (const page of this.connection.queryPages({ types: [type.name], frontmatterMode: "persisted" }, { pageSize: 1_000 })) {
        if (!page.ok) return fail(problemMessage(page));
        for (const r of page.value.results) {
          const comment = commentFromRecord(r.path, toContract(r.frontmatter ?? {}, type.fields), "");
          if (comment) out.set(r.path, { type: type.name, fields: type.fields, comment });
        }
      }
      return ok(out);
    });
  }

  async comments(scope?: readonly string[]): Promise<Result<CommentRecord[]>> {
    const refreshed = await this.flushChanges();
    if (!refreshed.ok) return refreshed;
    const generation = this.collectionGeneration;
    const metadata = await this.commentMetadata();
    if (!metadata.ok) return metadata;
    if (generation !== this.collectionGeneration) return this.comments(scope);
    const selected = new Set<string>();
    if (!scope) for (const path of metadata.value.keys()) selected.add(path);
    else {
      const index = await this.index();
      if (!index.ok) return index;
      if (this.commentPathsIndex?.paths !== index.value.recordPaths) this.commentPathsIndex = { paths: index.value.recordPaths, index: new PathIndex(index.value.recordPaths) };
      const documents = new Set(scope), replies = new Map<string, string[]>();
      const candidates = new PathIndex(metadata.value.keys());
      for (const [path, { comment }] of metadata.value) {
        const document = resolveLinkTarget(linkPath(comment.document), path, this.commentPathsIndex.index);
        if (document && documents.has(document)) selected.add(path);
        if (comment.inReplyTo) {
          const root = resolveLinkTarget(linkPath(comment.inReplyTo), path, candidates);
          if (root) { if (!replies.has(root)) replies.set(root, []); replies.get(root)!.push(path); }
        }
      }
      for (const path of selected) for (const reply of replies.get(path) ?? []) selected.add(reply);
    }
    const wanted = new Map([...selected].map((path) => [path, metadata.value.get(path)]));
    const byType = new Map<string, string[]>();
    for (const path of selected) if (!this.commentBodies.has(path)) {
      const type = metadata.value.get(path)!.type;
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type)!.push(path);
    }
    for (const [type, paths] of byType) for (let offset = 0; offset < paths.length; offset += 500) {
      for await (const page of this.connection.queryPages({ types: [type], where: `file.path in ${JSON.stringify(paths.slice(offset, offset + 500))}`, frontmatterMode: "persisted", includeBody: true }, { pageSize: 500 })) {
        if (!page.ok) return fail(problemMessage(page));
        for (const r of page.value.results) {
          if (generation !== this.collectionGeneration) return this.comments(scope);
          const entry = metadata.value.get(r.path);
          if (!entry || entry !== wanted.get(r.path)) continue;
          const fields = entry.fields;
          const comment = fields && commentFromRecord(r.path, toContract(r.frontmatter ?? {}, fields), r.body ?? "");
          if (comment) this.commentBodies.set(r.path, comment);
        }
      }
    }
    if (generation !== this.collectionGeneration) return this.comments(scope);
    return ok([...selected].flatMap((path) => { const comment = this.commentBodies.get(path); return comment ? [comment] : []; }));
  }

  async createComment(input: NewComment): Promise<Result<CommentRecord>> {
    const types = await this.implementingTypes(commentContract.id, "comments");
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
    const types = await this.implementingTypes(commentContract.id, "comments");
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
    const names = new Map<string, string>();
    for await (const page of this.connection.queryPages({ contract: PERSON_CONTRACT, frontmatterMode: "effective" }, { pageSize: 500 })) {
      if (!page.ok) return { ...NO_PEOPLE, signing };
      for (const r of page.value.results) {
        const name = (r.effectiveFrontmatter ?? r.frontmatter)?.["name"];
        if (typeof name === "string") names.set(personKey(r.path), name);
      }
    }
    return { names, signing };
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
    // Records of these contracts' types are not notes (Reader's starter annotation type is named as a fallback, when the contract is absent).
    const notNotes = new Set(["reader-annotation", "reader-source", "comment", "person"]);
    const described = await this.describe();
    const contracts = new Set<string>([commentContract.id, PERSON_CONTRACT.id, sourceContract.id, annotationContract.id]);
    if (described.ok) for (const c of described.value.contracts) if (contracts.has(c.id)) for (const i of c.implementations) notNotes.add(i.typeName);
    const recordPaths: string[] = [];
    const notePaths: string[] = [];
    for await (const page of this.connection.queryPages({ frontmatterMode: "persisted" }, { pageSize: 1_000 })) {
      if (!page.ok) return fail(problemMessage(page));
      for (const r of page.value.results) {
        recordPaths.push(r.path);
        if (r.path.toLowerCase().endsWith(".md") && !r.types.some((t) => notNotes.has(t))) notePaths.push(r.path);
      }
    }
    if (generation !== this.collectionGeneration) return fail("Collection discovery was superseded.");
    const files = new Map<string, CollectionFileDescriptor>();
    try {
      for await (const file of this.connection.files.list()) files.set(file.path, file);
    } catch (e) { return fail(errorMessage(e)); }
    if (generation !== this.collectionGeneration) return fail("Collection discovery was superseded.");
    this.recordSet = new Set(recordPaths);
    this.noteSet = new Set(notePaths);
    this.files.clear();
    for (const [path, file] of files) this.files.set(path, file);
    return ok({ recordPaths, filePaths: [...files.keys()].filter((p) => !/\.md$/i.test(p)), notePaths });
  }

  library(): Promise<Result<LibraryEntry[]>> { return this.libraryCache.load(() => this.loadLibrary()); }

  private async loadLibrary(): Promise<Result<LibraryEntry[]>> {
    const generation = ++this.libraryGeneration;
    const described = await this.describe();
    if (!described.ok) return fail(problemMessage(described));
    const contract = described.value.contracts.some((c) => c.id === sourceContract.id);
    const starter = described.value.types.some((t) => t.name === "reader-source");
    if (!contract && !starter) {
      if (generation === this.libraryGeneration && this.sourcePaths.size) {
        this.sourcePaths = new PathIndex([]);
        this.annotationGroups = undefined;
        this.annotationSources.clear();
      }
      return ok([]);
    }
    const entries: LibraryEntry[] = [];
    for await (const page of this.connection.queryPages({ ...(contract ? { contract: sourceContract } : { types: ["reader-source"] }), frontmatterMode: "effective" },  { pageSize: 1_000 })) {
      if (!page.ok) return fail(problemMessage(page));
      for (const r of page.value.results) {
        const entry = libraryEntry(r.path, r.effectiveFrontmatter ?? r.frontmatter);
        if (entry) entries.push(entry);
      }
    }
    if (generation === this.libraryGeneration && (entries.length !== this.sourcePaths.size || entries.some((e) => !this.sourcePaths.has(e.path)))) {
      this.sourcePaths = new PathIndex(entries.map((e) => e.path));
      this.annotationGroups = undefined;
      this.annotationSources.clear();
    }
    return ok(entries);
  }

  private annotationMetadata(): Promise<Result<Map<string, AnnotationMetadata>>> {
    if (!this.annotationIndex) {
      const job = this.loadAnnotationMetadata();
      this.annotationIndex = job;
      void job.then((out) => {
        if (this.annotationIndex !== job) return;
        if (out.ok) {
          this.annotationRows = out.value;
        } else this.annotationIndex = undefined;
      }, () => { if (this.annotationIndex === job) this.annotationIndex = undefined; });
    }
    return this.annotationIndex;
  }

  private async loadAnnotationMetadata(): Promise<Result<Map<string, AnnotationMetadata>>> {
    const generation = this.collectionGeneration;
    const described = await this.describe();
    if (!described.ok) return fail(problemMessage(described));
    // Unknown types query as empty in the SDK, but don't issue a needless probe.
    const contract = described.value.contracts.find((c) => c.id === annotationContract.id);
    const starter = described.value.types.some((t) => t.name === "reader-annotation");
    const types = contract ? await this.implementingTypes(annotationContract.id, "annotations") : ok(starter ? [{ name: "reader-annotation", fields: { source: "source", locator: "locator" }, typeKey: "type" }] : []);
    if (!types.ok) return types;
    if (generation !== this.collectionGeneration) return fail("Annotation discovery was superseded.");
    this.annotationTypes = types.value;
    return this.queryAnnotationMetadata();
  }

  private async queryAnnotationMetadata(paths?: readonly string[]): Promise<Result<Map<string, AnnotationMetadata>>> {
    const out = new Map<string, AnnotationMetadata>();
    for (const type of this.annotationTypes) {
      // select is additive (values), not a projection of frontmatter in the SDK/authority.
      for await (const page of this.connection.queryPages({ types: [type.name], frontmatterMode: "persisted", ...(paths ? { where: `file.path in ${JSON.stringify(paths)}` } : {}) }, { pageSize: 1_000 })) {
        if (!page.ok) return fail(problemMessage(page));
        for (const r of page.value.results) {
          const source = toContract(r.frontmatter ?? {}, type.fields)["source"];
          if (!out.has(r.path)) out.set(r.path, { path: r.path, type: type.name, source: typeof source === "string" ? annotationSourceLink(source) ?? "" : "", fields: type.fields });
        }
      }
    }
    return ok(out);
  }

  async annotationPaths(): Promise<Result<readonly string[]>> {
    const refreshed = await this.flushChanges();
    if (!refreshed.ok) return refreshed;
    const index = await this.annotationMetadata();
    return index.ok ? ok([...index.value.keys()]) : index;
  }

  async annotationsForSource(path: string): Promise<Result<SourceAnnotation[]>> {
    const refreshed = await this.flushChanges();
    if (!refreshed.ok) return refreshed;
    const index = await this.annotationMetadata();
    if (!index.ok) return index;
    const known = this.annotationSources.get(path);
    if (known) return known;
    if (index.value.size && !this.sourcePaths.has(path)) {
      const library = await this.library();
      if (!library.ok) return library;
      const loaded = this.annotationSources.get(path);
      if (loaded) return loaded;
    }
    const job = this.loadAnnotationsForSource(path, index.value);
    this.annotationSources.set(path, job);
    void job.then((out) => {
      if (!out.ok && this.annotationSources.get(path) === job) this.annotationSources.delete(path);
    }, () => { if (this.annotationSources.get(path) === job) this.annotationSources.delete(path); });
    return job;
  }

  private async loadAnnotationsForSource(path: string, index: Map<string, AnnotationMetadata>): Promise<Result<SourceAnnotation[]>> {
    if (!index.size) return ok([]);
    // Metadata resolves aliased/relative/bare links safely; source equality filters would omit them.
    if (this.annotationGroups?.metadata !== index || this.annotationGroups.sources !== this.sourcePaths) {
      const groups = new Map<string, Map<string, AnnotationMetadata>>();
      for (const a of index.values()) {
        const source = a.source ? resolveLinkTarget(a.source, a.path, this.sourcePaths) : null;
        if (!source) continue;
        if (!groups.has(source)) groups.set(source, new Map());
        groups.get(source)!.set(a.path, a);
      }
      this.annotationGroups = { metadata: index, sources: this.sourcePaths, groups };
    }
    const selected = this.annotationGroups.groups.get(path) ?? new Map<string, AnnotationMetadata>();
    const byType = new Map<string, string[]>();
    for (const a of selected.values()) {
      if (!byType.has(a.type)) byType.set(a.type, []);
      byType.get(a.type)!.push(a.path);
    }
    const out = new Map<string, SourceAnnotation>();
    for (const [type, paths] of byType) for (let offset = 0; offset < paths.length; offset += 500) {
      // Bounded CEL path lists; queryPages limit is page size, never a total-result cap.
      const where = `file.path in ${JSON.stringify(paths.slice(offset, offset + 500))}`;
      for await (const page of this.connection.queryPages({ types: [type], where, frontmatterMode: "persisted", includeBody: true }, { pageSize: 500 })) {
        if (!page.ok) return fail(problemMessage(page));
        for (const r of page.value.results) {
          const a = selected.get(r.path);
          if (!a) continue;
          const annotation = sourceAnnotation(r.path, toContract(r.frontmatter ?? {}, a.fields), r.body ?? "");
          if (annotation) out.set(r.path, annotation);
        }
      }
    }
    return ok([...out.values()]);
  }

  readBody(path: string): Promise<Result<string>> {
    const cached = this.bodyCache.get(path);
    if (cached) return cached;
    const job = this.connection.read({ path }).then((read) => read.ok ? ok(read.value.body ?? "") : fail<string>(problemMessage(read)));
    this.bodyCache.set(path, job);
    void job.then((out) => { if (!out.ok && this.bodyCache.get(path) === job) this.bodyCache.delete(path); }, () => { if (this.bodyCache.get(path) === job) this.bodyCache.delete(path); });
    return job;
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
        await Promise.all([this.indexCache.pending, this.libraryCache.pending, this.manuscriptCache.pending, this.commentCache.pending, this.annotationIndex]);
        if (generation !== this.collectionGeneration) continue;
        const paths = [...this.changedPaths].slice(0, 500);
        for (const path of paths) this.changedPaths.delete(path);
        try {
          const described = await this.describe();
          if (!described.ok) throw new Error(problemMessage(described));
          const rows = new Map<string, QueryRecord<JsonObject>>();
          for await (const page of this.connection.queryPages({ where: `file.path in ${JSON.stringify(paths)}`, frontmatterMode: "both" }, { pageSize: 500, signal: this.lifetime.signal })) {
            if (!page.ok) throw new Error(problemMessage(page));
            for (const row of page.value.results) rows.set(row.path, row);
          }
          if (generation !== this.collectionGeneration) continue;
          const typeFor = (id: string, row: QueryRecord<JsonObject> | undefined, starter: string) => {
            const implementation = described.value.contracts.find((c) => c.id === id)?.implementations.find((i) => row?.types.includes(i.typeName));
            return implementation ? { name: implementation.typeName, fields: implementation.fields } : row?.types.includes(starter) ? { name: starter, fields: {} } : undefined;
          };
          let indexChanged = false, annotations = false, comments = false;
          const library = this.libraryCache.value && new Map(this.libraryCache.value.map((e) => [e.path, e]));
          const manuscripts = this.manuscriptCache.value && new Map(this.manuscriptCache.value.map((e) => [e.path, e]));
          let libraryChanged = false, manuscriptsChanged = false;
          for (const path of paths) {
            const row = rows.get(path);
            if (this.indexCache.value && /\.md$/i.test(path)) {
              const note = !!row && ![sourceContract.id, annotationContract.id, commentContract.id, PERSON_CONTRACT.id].some((id) => typeFor(id, row, id === sourceContract.id ? "reader-source" : id === annotationContract.id ? "reader-annotation" : id === commentContract.id ? "comment" : "person"));
              if (this.recordSet.has(path) !== !!row || this.noteSet.has(path) !== note) indexChanged = true;
              if (row) this.recordSet.add(path); else this.recordSet.delete(path);
              if (note) this.noteSet.add(path); else this.noteSet.delete(path);
            }
            const source = typeFor(sourceContract.id, row, "reader-source");
            if (library) {
              const next = source && row ? libraryEntry(path, Object.keys(source.fields).length ? toContract(row.effectiveFrontmatter ?? row.frontmatter ?? {}, source.fields) : row.effectiveFrontmatter ?? row.frontmatter) : null;
              if (!equal(library.get(path) ?? null, next)) {
                libraryChanged = true;
                if (next) library.set(path, next); else library.delete(path);
              }
            }
            const manuscript = typeFor(manuscriptContract.id, row, "writer-manuscript");
            if (manuscripts) {
              const fields = row && manuscript ? Object.keys(manuscript.fields).length ? toContract(row.effectiveFrontmatter ?? row.frontmatter ?? {}, manuscript.fields) : row.effectiveFrontmatter ?? row.frontmatter ?? {} : undefined;
              const next: ManuscriptSummary | undefined = fields ? { path, title: typeof fields["title"] === "string" ? fields["title"] : path, ...(typeof fields["template"] === "string" ? { template: fields["template"] } : {}), ...(typeof fields["csl"] === "string" ? { style: fields["csl"] } : {}), ...(row?.file.mtime ? { modified: row.file.mtime } : {}) } : undefined;
              if (!equal(manuscripts.get(path), next)) { manuscriptsChanged = true; if (next) manuscripts.set(path, next); else manuscripts.delete(path); }
            }
            const annotation = typeFor(annotationContract.id, row, "reader-annotation");
            if (this.annotationIndex) {
              const localFields = annotation?.fields && Object.keys(annotation.fields).length ? annotation.fields : { source: "source", locator: "locator" };
              const target = row && annotation ? toContract(row.frontmatter ?? {}, localFields)["source"] : undefined;
              const next = annotation && row ? { path, type: annotation.name, source: typeof target === "string" ? annotationSourceLink(target) ?? "" : "", fields: localFields } : undefined;
              const previous = this.annotationRows.get(path);
              if (previous || next) {
                annotations = true;
                for (const [entry, remove] of [[previous, true], [next, false]] as const) {
                  if (!entry) continue;
                  const sourcePath = resolveLinkTarget(entry.source, path, this.sourcePaths);
                  if (!sourcePath) continue;
                  this.annotationSources.delete(sourcePath);
                  if (this.annotationGroups?.metadata !== this.annotationRows) continue;
                  const groups = this.annotationGroups.groups;
                  if (remove) groups.get(sourcePath)?.delete(path);
                  else { if (!groups.has(sourcePath)) groups.set(sourcePath, new Map()); groups.get(sourcePath)!.set(path, entry); }
                }
                if (next) this.annotationRows.set(path, next); else this.annotationRows.delete(path);
              }
            }
            const comment = typeFor(commentContract.id, row, "comment");
            const commentRows = this.commentCache.value;
            if (commentRows) {
              const value = comment && row ? commentFromRecord(path, Object.keys(comment.fields).length ? toContract(row.frontmatter ?? {}, comment.fields) : row.frontmatter ?? {}, "") : null;
              if (value || commentRows.has(path)) {
                comments = true;
                this.commentBodies.delete(path);
                if (value && comment) commentRows.set(path, { type: comment.name, fields: comment.fields, comment: value }); else commentRows.delete(path);
              }
            }
          }
          // The SDK has no exact binary stat: refresh only affected folders, never all Markdown.
          const folders = new Set(paths.filter((p) => !/\.md$/i.test(p)).map((p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : ""));
          for (const folder of folders) {
            const found = new Map<string, CollectionFileDescriptor>();
            for await (const file of this.connection.files.list({ folder, signal: this.lifetime.signal })) if (paths.includes(file.path)) found.set(file.path, file);
            for (const path of paths.filter((p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "") === folder && !/\.md$/i.test(p))) {
              if (this.files.has(path) !== found.has(path)) indexChanged = true;
              if (found.has(path)) this.files.set(path, found.get(path)!); else this.files.delete(path);
            }
          }
          const delta: CollectionDelta = { paths, ...(annotations ? { annotations: true } : {}), ...(comments ? { comments: true } : {}) };
          if (indexChanged && this.indexCache.value) {
            const index = { recordPaths: [...this.recordSet], notePaths: [...this.noteSet], filePaths: [...this.files.keys()].filter((p) => !/\.md$/i.test(p)) };
            this.indexCache.set(index);
            Object.assign(delta, { index });
          }
          if (libraryChanged && library) {
            const entries = [...library.values()];
            this.libraryCache.set(entries);
            if (entries.length !== this.sourcePaths.size || entries.some((e) => !this.sourcePaths.has(e.path))) {
              this.sourcePaths = new PathIndex(entries.map((e) => e.path));
              this.annotationGroups = undefined;
              this.annotationSources.clear();
            }
            Object.assign(delta, { library: entries });
          }
          if (manuscriptsChanged && manuscripts) {
            const entries = [...manuscripts.values()].sort((a, b) => a.title.localeCompare(b.title));
            this.manuscriptCache.set(entries);
            Object.assign(delta, { manuscripts: entries });
          }
          this.publish(delta);
        } catch (error) { for (const path of paths) this.changedPaths.add(path); throw error; }
      }
      return ok(undefined);
    } catch (error) {
      const message = errorMessage(error);
      this.publish({ paths: [], problem: message });
      return fail(message);
    }
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
    this.description = undefined;
    this.indexCache.clear(); this.libraryCache.clear(); this.manuscriptCache.clear(); this.commentCache.clear();
    this.commentBodies.clear(); this.bodyCache.clear();
    this.invalidateAnnotations();
    const results = await Promise.all([this.index(), this.library(), this.listManuscripts(), this.annotationMetadata(), this.commentMetadata()]);
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
