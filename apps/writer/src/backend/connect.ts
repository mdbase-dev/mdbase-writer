// The writer on a real collection through mdbase connect.
import { PERSON_CONTRACT, type CollectionFileDescriptor, type JsonObject, type MdbaseConnection } from "@mdbase-dev/connect";
import { commentFromRecord, type CommentRecord } from "@mdbase-writer/core/comments";
import { annotationSourceLink } from "@mdbase-writer/core/annotations";
import { PathIndex, resolveLinkTarget } from "@mdbase-writer/core/records";
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

const problemMessage = (outcome: { ok: false; problem: { message?: string; code: string } }) => outcome.problem.message ?? outcome.problem.code;

export class ConnectBackend implements WriterBackend {
  readonly kind = "connect";
  private readonly files = new Map<string, CollectionFileDescriptor>();
  private readonly listeners = new Set<(paths: readonly string[]) => void>();
  private readonly staleFiles = new Set<string>();
  private readonly lifetime = new AbortController();
  private stopFollowing: (() => void) | undefined;
  private description: ReturnType<MdbaseConnection<JsonObject>["describe"]> | undefined;
  private schemaPaths: ReadonlySet<string> = new Set(["mdbase.yaml"]);
  private schemaFolders: readonly string[] = ["_types", "_contracts"];
  private annotationIndex: Promise<Result<Map<string, AnnotationMetadata>>> | undefined;
  private annotationRefresh: Promise<Result<Map<string, AnnotationMetadata>>> | undefined;
  private readonly dirtyAnnotations = new Set<string>();
  private annotationRows = new Map<string, AnnotationMetadata>();
  private annotationTypes: ImplementingType[] = [];
  private readonly knownPaths = new Set<string>();
  private readonly annotationSources = new Map<string, Promise<Result<SourceAnnotation[]>>>();
  private sourcePaths = new PathIndex([]);
  private libraryGeneration = 0;
  private annotationGroups: { metadata: Map<string, AnnotationMetadata>; sources: PathIndex; groups: Map<string, Map<string, AnnotationMetadata>> } | undefined;

  annotationFields(path: string, types: readonly string[] = []): Readonly<Record<string, string>> {
    return this.annotationRows.get(path)?.fields ?? this.annotationTypes.find((t) => types.includes(t.name))?.fields ?? {};
  }

  private invalidateAnnotations(): void {
    this.annotationIndex = undefined;
    this.annotationRefresh = undefined;
    this.dirtyAnnotations.clear();
    this.annotationSources.clear();
    this.annotationGroups = undefined;
  }

  private describe(): ReturnType<MdbaseConnection<JsonObject>["describe"]> {
    return this.description ??= this.connection.describe().then((out) => {
      if (!out.ok) this.description = undefined;
      else {
        this.schemaPaths = new Set(["mdbase.yaml", ...out.value.types.flatMap((t) => t.path ? [t.path] : []), ...out.value.contracts.flatMap((c) => c.implementations.flatMap((i) => i.typePath ? [i.typePath] : []))]);
        const settings = out.value.configuration?.["settings"] as JsonObject | undefined;
        this.schemaFolders = [settings?.["types_folder"] ?? "_types", settings?.["contracts_folder"] ?? "_contracts"].filter((p): p is string => typeof p === "string" && !!p).map((p) => p.replace(/^\.\//, "").replace(/\/+$/, ""));
      }
      return out;
    }).catch((error: unknown) => { this.description = undefined; throw error; });
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

  get records() {
    return { open: async (...args: Parameters<MdbaseConnection<JsonObject>["records"]["open"]>) => {
      const opened = await this.connection.records.open(...args);
      if (opened.ok) this.knownPaths.add(args[0]);
      return opened;
    } };
  }

  private async startWatch(): Promise<void> {
    const watch = await this.connection.watch({ lifetimeSignal: this.lifetime.signal }, { timeoutMs: 30_000 });
    if (!watch.ok) return;
    this.stopFollowing = this.connection.records.follow(watch.value);
    watch.value.subscribe(
      (change) => {
        const paths = [...new Set([change.payload["path"], change.payload["from"], change.payload["to"]].filter((p): p is string => typeof p === "string"))];
        const schemaChanged = /type|contract|configuration/.test(change.type) || paths.some((p) => this.schemaPaths.has(p) || this.schemaFolders.some((folder) => p.startsWith(`${folder}/`)));
        if (schemaChanged) this.description = undefined;
        if (schemaChanged || paths.some((p) => !this.knownPaths.has(p) && !this.annotationRows.has(p))) this.invalidateAnnotations();
        else for (const path of paths) {
          const annotation = this.annotationRows.get(path);
          if (!annotation) continue;
          this.dirtyAnnotations.add(path);
          const source = resolveLinkTarget(annotation.source, path, this.sourcePaths);
          if (source) this.annotationSources.delete(source);
        }
        if (/deleted/.test(change.type)) for (const path of paths) this.knownPaths.delete(path);
        if (/renamed/.test(change.type) && typeof change.payload["from"] === "string") this.knownPaths.delete(change.payload["from"]);
        for (const path of paths) if (this.files.has(path)) this.staleFiles.add(path);
        if (paths.length || schemaChanged) for (const l of this.listeners) l(schemaChanged ? [] : paths);
      },
      (status) => {
        if (status.state !== "reset_required") return;
        this.description = undefined;
        this.invalidateAnnotations();
        for (const l of this.listeners) l([]);
      },
      () => {},
    );
  }

  async listManuscripts(): Promise<Result<ManuscriptSummary[]>> {
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

  async comments(): Promise<Result<CommentRecord[]>> {
    const types = await this.implementingTypes(commentContract.id, "comments");
    if (!types.ok) return types;
    // A contract view cannot include bodies: query the implementing types and map their fields here.
    const out: CommentRecord[] = [];
    const byName = new Map(types.value.map((t) => [t.name, t]));
    for await (const page of this.connection.queryPages({ types: [...byName.keys()], frontmatterMode: "persisted", includeBody: true }, { pageSize: 500 })) {
      if (!page.ok) return fail(problemMessage(page));
      for (const r of page.value.results) {
        const type = r.types.map((t) => byName.get(t)).find(Boolean);
        if (!type) continue;
        this.knownPaths.add(r.path);
        const comment = commentFromRecord(r.path, toContract(r.frontmatter ?? {}, type.fields), r.body ?? "");
        if (comment) out.push(comment);
      }
    }
    return ok(out);
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

  async index(): Promise<Result<CollectionIndex>> {
    // Records of these contracts' types are not notes (Reader's starter annotation type is named as a fallback, when the contract is absent).
    const notNotes = new Set(["reader-annotation"]);
    const described = await this.describe();
    const contracts = new Set<string>([commentContract.id, PERSON_CONTRACT.id, sourceContract.id, annotationContract.id]);
    if (described.ok) for (const c of described.value.contracts) if (contracts.has(c.id)) for (const i of c.implementations) notNotes.add(i.typeName);
    const recordPaths: string[] = [];
    const notePaths: string[] = [];
    for await (const page of this.connection.queryPages({ frontmatterMode: "persisted" }, { pageSize: 1_000 })) {
      if (!page.ok) return fail(problemMessage(page));
      for (const r of page.value.results) {
        recordPaths.push(r.path);
        this.knownPaths.add(r.path);
        if (r.path.toLowerCase().endsWith(".md") && !r.types.some((t) => notNotes.has(t))) notePaths.push(r.path);
      }
    }
    this.files.clear();
    try {
      for await (const file of this.connection.files.list()) { this.files.set(file.path, file); this.knownPaths.add(file.path); }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    return ok({ recordPaths, filePaths: [...this.files.keys()].filter((p) => !p.endsWith(".md")), notePaths });
  }

  async library(): Promise<Result<LibraryEntry[]>> {
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
        this.knownPaths.add(r.path);
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
          for (const path of out.value.keys()) this.knownPaths.add(path);
        } else this.annotationIndex = undefined;
      }, () => { if (this.annotationIndex === job) this.annotationIndex = undefined; });
    }
    if (!this.dirtyAnnotations.size) return this.annotationRefresh ?? this.annotationIndex;
    if (!this.annotationRefresh) {
      const job = this.refreshAnnotationMetadata(this.annotationIndex);
      this.annotationRefresh = job;
      const clear = () => { if (this.annotationRefresh === job) this.annotationRefresh = undefined; };
      void job.then(clear, clear);
    }
    return this.annotationRefresh;
  }

  private async loadAnnotationMetadata(): Promise<Result<Map<string, AnnotationMetadata>>> {
    const described = await this.describe();
    if (!described.ok) return fail(problemMessage(described));
    // Unknown types query as empty in the SDK, but don't issue a needless probe.
    const contract = described.value.contracts.find((c) => c.id === annotationContract.id);
    const starter = described.value.types.some((t) => t.name === "reader-annotation");
    const types = contract ? await this.implementingTypes(annotationContract.id, "annotations") : ok(starter ? [{ name: "reader-annotation", fields: { source: "source", locator: "locator" }, typeKey: "type" }] : []);
    if (!types.ok) return types;
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

  private async refreshAnnotationMetadata(base: Promise<Result<Map<string, AnnotationMetadata>>>): Promise<Result<Map<string, AnnotationMetadata>>> {
    const index = await base;
    if (!index.ok) return index;
    while (this.dirtyAnnotations.size && base === this.annotationIndex) {
      const paths = [...this.dirtyAnnotations].slice(0, 500);
      for (const path of paths) this.dirtyAnnotations.delete(path);
      let updated: Result<Map<string, AnnotationMetadata>>;
      try { updated = await this.queryAnnotationMetadata(paths); }
      catch (error) { for (const path of paths) this.dirtyAnnotations.add(path); throw error; }
      if (!updated.ok) { for (const path of paths) this.dirtyAnnotations.add(path); return updated; }
      if (base !== this.annotationIndex) break;
      for (const path of paths) {
        const previous = index.value.get(path), next = updated.value.get(path);
        for (const [entry, remove] of [[previous, true], [next, false]] as const) {
          if (!entry) continue;
          const source = resolveLinkTarget(entry.source, path, this.sourcePaths);
          if (!source) continue;
          this.annotationSources.delete(source);
          if (this.annotationGroups?.metadata !== index.value) continue;
          const groups = this.annotationGroups.groups;
          if (remove) groups.get(source)?.delete(path);
          else {
            if (!groups.has(source)) groups.set(source, new Map());
            groups.get(source)!.set(path, entry);
          }
        }
        if (next) index.value.set(path, next);
        else index.value.delete(path);
      }
    }
    return base === this.annotationIndex ? index : this.annotationMetadata();
  }

  async annotationPaths(): Promise<Result<readonly string[]>> {
    const index = await this.annotationMetadata();
    return index.ok ? ok([...index.value.keys()]) : index;
  }

  async annotationsForSource(path: string): Promise<Result<SourceAnnotation[]>> {
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

  async readBody(path: string): Promise<Result<string>> {
    const read = await this.connection.read({ path });
    return read.ok ? ok(read.value.body ?? "") : fail(problemMessage(read));
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

  onExternalChange(listener: (paths: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.stopFollowing?.();
    this.lifetime.abort();
    this.listeners.clear();
  }
}
