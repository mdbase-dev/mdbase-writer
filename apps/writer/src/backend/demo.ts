// A self-contained demo collection on the SDK's in-memory record authority:
// real record sessions (autosave, conflicts, recovery) without an account.
// Loaded only in development builds.
import type { JsonObject } from "@mdbase-dev/connect";
import { createRecordTestAuthority } from "@mdbase-dev/connect-testing";
import { splitFrontmatter, type CslItem } from "@mdbase-writer/core";

import { fail, manuscriptSlug, ok, type CollectionIndex, type LibraryEntry, type ManuscriptSummary, type NewManuscript, type Result, type WriterBackend } from "./types.js";

const markdown = import.meta.glob("../../demo/**/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const assets = import.meta.glob("../../demo/**/*.{svg,png,jpg}", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const relative = (key: string) => key.replace(/^\.\.\/\.\.\/demo\//, "");

export async function createDemoBackend(): Promise<WriterBackend> {
  const authority = createRecordTestAuthority();
  const paths = new Set<string>();
  for (const [key, text] of Object.entries(markdown)) {
    const { body, frontmatter } = splitFrontmatter(text);
    authority.seed(relative(key), { body, frontmatter: frontmatter as JsonObject });
    paths.add(relative(key));
  }
  authority.records.follow(authority.watch);
  const library = (await import("../../../../packages/core/test/fixtures/library.json")).default as CslItem[];
  const entries: LibraryEntry[] = library.map((item) => ({
    key: item.id,
    item,
    title: typeof item["title"] === "string" ? item["title"] : item.id,
    path: `sources/${item.id}.md`,
  }));
  const files = new Map(Object.entries(assets).map(([key, url]) => [relative(key), url]));
  const listeners = new Set<(paths: readonly string[]) => void>();
  const manuscripts = new Map<string, ManuscriptSummary>();
  for (const path of paths) {
    const { frontmatter } = splitFrontmatter(markdown[`../../demo/${path}`] ?? "");
    if (frontmatter["type"] === "writer-manuscript") {
      manuscripts.set(path, { path, title: String(frontmatter["title"] ?? path), template: String(frontmatter["template"] ?? "article") });
    }
  }

  const backend: WriterBackend & { authority: typeof authority } = {
    /** Exposed so browser tests can simulate other applications' edits. */
    authority,
    kind: "demo",
    collectionName: "Demo collection",
    records: authority.records,
    async listManuscripts() {
      return ok([...manuscripts.values()].sort((a, b) => a.title.localeCompare(b.title)));
    },
    async createManuscript(input: NewManuscript): Promise<Result<string>> {
      let path = `manuscripts/${manuscriptSlug(input.title)}.md`;
      for (let n = 2; paths.has(path); n++) path = `manuscripts/${manuscriptSlug(input.title)}-${n}.md`;
      authority.seed(path, {
        body: "# Introduction {#sec-intro}\n\n",
        frontmatter: { type: "writer-manuscript", title: input.title, template: input.template, csl: input.style },
      });
      paths.add(path);
      manuscripts.set(path, { path, title: input.title, template: input.template, style: input.style });
      return ok(path);
    },
    async index(): Promise<Result<CollectionIndex>> {
      return ok({ recordPaths: [...paths], filePaths: [...files.keys()] });
    },
    async library() {
      return ok(entries);
    },
    async readFile(path: string) {
      const url = files.get(path);
      if (!url) return fail(`No file at ${path}.`);
      return ok(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    },
    onExternalChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
    },
  };
  return backend;
}
