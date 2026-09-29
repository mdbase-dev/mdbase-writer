// A self-contained demo collection on the SDK's in-memory record authority:
// real record sessions (autosave, conflicts, recovery) without an account.
// Loaded only in development builds.
import type { JsonObject } from "@mdbase-dev/connect";
import { createRecordTestAuthority } from "@mdbase-dev/connect-testing";
import type { CslItem } from "@mdbase-writer/core";
import { splitFrontmatter } from "@mdbase-writer/core/records";

import { bodySummary, fail, manuscriptSlug, numberedPath, ok, sourceAnnotation, titleFromNote, withType, type CollectionIndex, type LibraryEntry, type ManuscriptSummary, type NewManuscript, type Result, type WriterBackend } from "./types.js";

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
  // Only the sources the demo manuscripts cite (the demo ships with public builds).
  const library = (await import("../../demo/library.json")).default as CslItem[];
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
      manuscripts.set(path, {
        path,
        title: String(frontmatter["title"] ?? path),
        template: String(frontmatter["template"] ?? "article"),
        ...(typeof frontmatter["csl"] === "string" ? { style: frontmatter["csl"] } : {}),
      });
    }
  }

  const backend: WriterBackend & { authority: typeof authority } = {
    /** Exposed so browser tests can simulate other applications' edits. */
    authority,
    kind: "demo",
    collectionName: "Demo collection",
    records: authority.records,
    async listManuscripts() {
      const out: ManuscriptSummary[] = [];
      for (const m of manuscripts.values()) {
        // The body as it is now, edits in this demo included.
        const opened = await authority.records.open(m.path, { autosave: false });
        if (!opened.ok) {
          out.push(m);
          continue;
        }
        out.push({ ...m, ...bodySummary(opened.value.session.getSnapshot().body) });
        opened.value.release();
      }
      return ok(out.sort((a, b) => a.title.localeCompare(b.title)));
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
    async adoptManuscript(path: string): Promise<Result<string>> {
      const opened = await authority.records.open(path, { autosave: false });
      if (!opened.ok) return fail(opened.problem.message ?? opened.problem.code);
      const { session, release } = opened.value;
      const { frontmatter, body } = session.getSnapshot();
      const title = typeof frontmatter["title"] === "string" && frontmatter["title"] ? frontmatter["title"] : titleFromNote(path, body);
      session.patchFrontmatter({ type: withType(frontmatter["type"], "writer-manuscript"), title });
      const flushed = await session.flush();
      release();
      if (!flushed.ok) return fail(flushed.problem.message ?? flushed.problem.code);
      manuscripts.set(path, { path, title });
      return ok(path);
    },
    async createRecord(path: string, body: string) {
      let at = path;
      for (let n = 2; paths.has(at); n++) at = numberedPath(path, n);
      authority.seed(at, { body, frontmatter: {} });
      paths.add(at);
      return ok(at);
    },
    async index(): Promise<Result<CollectionIndex>> {
      return ok({ recordPaths: [...paths], filePaths: [...files.keys()] });
    },
    async library() {
      return ok(entries);
    },
    async annotations() {
      const out = [];
      for (const path of paths) {
        const { body, frontmatter } = splitFrontmatter(markdown[`../../demo/${path}`] ?? "");
        if (frontmatter["type"] !== "reader-annotation") continue;
        const a = sourceAnnotation(path, frontmatter as JsonObject, body);
        if (a) out.push(a);
      }
      return ok(out);
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
