// The writer on a real collection through mdbase connect.
import type { CollectionFileDescriptor, JsonObject, MdbaseConnection } from "@mdbase-dev/connect";

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

const problemMessage = (outcome: { ok: false; problem: { message?: string; code: string } }) => outcome.problem.message ?? outcome.problem.code;

export class ConnectBackend implements WriterBackend {
  readonly kind = "connect";
  private readonly files = new Map<string, CollectionFileDescriptor>();
  private readonly listeners = new Set<(paths: readonly string[]) => void>();
  private readonly lifetime = new AbortController();
  private stopFollowing: (() => void) | undefined;

  constructor(private readonly connection: MdbaseConnection<JsonObject>) {
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
  private async manuscriptType(): Promise<Result<{ name: string; fields: Record<string, string>; typeKey: string }>> {
    const described = await this.connection.describe();
    if (!described.ok) return fail(problemMessage(described));
    const implementation = described.value.contracts.find((c) => c.id === manuscriptContract.id)?.implementations[0];
    if (!implementation) return fail("This collection has no type for manuscripts. Set it up again from mdbase connect.");
    const settings = described.value.configuration?.["settings"] as { explicit_type_keys?: unknown } | undefined;
    const keys = settings?.explicit_type_keys;
    // With explicit type keys turned off, the starter type still matches on `type`.
    const typeKey = Array.isArray(keys) && typeof keys[0] === "string" ? keys[0] : "type";
    return ok({ name: implementation.typeName, fields: implementation.fields, typeKey });
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
