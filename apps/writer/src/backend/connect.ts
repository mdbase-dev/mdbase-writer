// The writer on a real collection through mdbase connect.
import { PERSON_CONTRACT, type CollectionFileDescriptor, type JsonObject, type MdbaseConnection } from "@mdbase-dev/connect";
import { commentFromRecord, type CommentRecord } from "@mdbase-writer/core/comments";

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
  bodySummary,
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

const problemMessage = (outcome: { ok: false; problem: { message?: string; code: string } }) => outcome.problem.message ?? outcome.problem.code;

export class ConnectBackend implements WriterBackend {
  readonly kind = "connect";
  private readonly files = new Map<string, CollectionFileDescriptor>();
  private readonly listeners = new Set<(paths: readonly string[]) => void>();
  private readonly lifetime = new AbortController();
  private stopFollowing: (() => void) | undefined;

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

  get records() {
    return this.connection.records;
  }

  private async startWatch(): Promise<void> {
    const watch = await this.connection.watch({ lifetimeSignal: this.lifetime.signal }, { timeoutMs: 30_000 });
    if (!watch.ok) return;
    this.stopFollowing = this.connection.records.follow(watch.value);
    watch.value.subscribe(
      (change) => {
        const path = (change.payload as { path?: string } | undefined)?.path;
        if (path) for (const l of this.listeners) l([path]);
      },
      () => {},
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
    // A contract-view query cannot include bodies; read each manuscript for its
    // word count (a manuscript that cannot be read is listed without one).
    const summaries = await Promise.all(
      out.map(async (m) => {
        const read = await this.connection.read({ path: m.path });
        return read.ok ? { ...m, ...bodySummary(read.value.body) } : m;
      }),
    );
    return ok(summaries.sort((a, b) => a.title.localeCompare(b.title)));
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
    const described = await this.connection.describe();
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
    let last = "";
    for (let n = 1; n <= 20; n++) {
      const created = await this.connection.create({
        type: name,
        path: `manuscripts/${slug}${n > 1 ? `-${n}` : ""}.md`,
        frontmatter,
        body: `# Introduction {#sec-intro}\n\n`,
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
    const recordPaths: string[] = [];
    for await (const page of this.connection.queryPages({ frontmatterMode: "persisted" }, { pageSize: 1_000 })) {
      if (!page.ok) return fail(problemMessage(page));
      for (const r of page.value.results) recordPaths.push(r.path);
    }
    this.files.clear();
    try {
      for await (const file of this.connection.files.list()) this.files.set(file.path, file);
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
    return ok({ recordPaths, filePaths: [...this.files.keys()].filter((p) => !p.endsWith(".md")) });
  }

  async library(): Promise<Result<LibraryEntry[]>> {
    const entries: LibraryEntry[] = [];
    for await (const page of this.connection.queryPages({ contract: sourceContract, frontmatterMode: "effective" }, { pageSize: 1_000 })) {
      if (!page.ok) return fail(problemMessage(page));
      for (const r of page.value.results) {
        const entry = libraryEntry(r.path, r.effectiveFrontmatter ?? r.frontmatter);
        if (entry) entries.push(entry);
      }
    }
    return ok(entries);
  }

  async annotations(): Promise<Result<SourceAnnotation[]>> {
    // The writer does not provision Reader's annotation contract; where Reader
    // has, query through it, else by Reader's starter type name.
    const collect = async (query: Parameters<MdbaseConnection<JsonObject>["queryPages"]>[0]): Promise<Result<SourceAnnotation[]>> => {
      const out: SourceAnnotation[] = [];
      for await (const page of this.connection.queryPages(query, { pageSize: 500 })) {
        if (!page.ok) return fail(problemMessage(page));
        for (const r of page.value.results) {
          const a = sourceAnnotation(r.path, r.effectiveFrontmatter ?? r.frontmatter, r.body ?? "");
          if (a) out.push(a);
        }
      }
      return ok(out);
    };
    const byContract = await collect({ contract: annotationContract, frontmatterMode: "effective", includeBody: true });
    return byContract.ok ? byContract : collect({ types: ["reader-annotation"], frontmatterMode: "persisted", includeBody: true });
  }

  async readFile(path: string): Promise<Result<Uint8Array>> {
    const file = this.files.get(path);
    if (!file) return fail(`No file at ${path}.`);
    try {
      return ok(await this.connection.files.downloadBytes(file));
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
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
