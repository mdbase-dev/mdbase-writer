// The writer on a real collection through mdbase connect.
import type { CollectionFileDescriptor, JsonObject, MdbaseConnection } from "@mdbase-dev/connect";

import { fail, libraryEntry, manuscriptSlug, ok, type CollectionIndex, type LibraryEntry, type ManuscriptSummary, type NewManuscript, type Result, type WriterBackend } from "./types.js";

export const manuscriptContract = { id: "dev.mdbase.writer.manuscript", version: "1.0.0-beta.1" } as const;
export const sourceContract = { id: "dev.mdbase.reader.source", version: "1.0.0-beta.1" } as const;

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
        });
      }
    }
    return ok(out.sort((a, b) => a.title.localeCompare(b.title)));
  }

  async createManuscript(input: NewManuscript): Promise<Result<string>> {
    const created = await this.connection.create({
      contract: manuscriptContract,
      path: `manuscripts/${manuscriptSlug(input.title)}.md`,
      frontmatter: { title: input.title, template: input.template, csl: input.style },
      body: `# Introduction {#sec-intro}\n\n`,
    });
    return created.ok ? ok(created.value.path) : fail(problemMessage(created));
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
