// A self-contained demo collection on the SDK's in-memory record authority:
// real record sessions (autosave, conflicts, recovery) without an account.
// Loaded only in development builds.
import type { JsonObject } from "@mdbase-dev/connect";
import { createRecordTestAuthority } from "@mdbase-dev/connect-testing";
import type { CslItem } from "@mdbase-writer/core";
import { commentFromRecord, linkPath, type CommentRecord } from "@mdbase-writer/core/comments";
import { annotationSourceLink } from "@mdbase-writer/core/annotations";
import { PathIndex, resolveLinkTarget, splitFrontmatter } from "@mdbase-writer/core/records";

import { changeFields, commentPath, newCommentFields, personKey, personLink, type People } from "./comments.js";
import { manuscriptBody, bodySummary, fail, manuscriptSlug, numberedPath, ok, sourceAnnotation, titleFromNote, withType, libraryEntry, type CollectionDelta, type CollectionIndex, type LibraryEntry, type ManuscriptSummary, type NewManuscript, type Result, type WriterBackend } from "./types.js";

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
  const stopFollowing = authority.records.follow(authority.watch);
  // Only the sources the demo manuscripts cite (the demo ships with public builds).
  const library = (await import("../../demo/library.json")).default as CslItem[];
  let entries: LibraryEntry[] = library.map((item) => ({
    key: item.id,
    item,
    title: typeof item["title"] === "string" ? item["title"] : item.id,
    path: `sources/${item.id}.md`,
  }));
  let sourcePaths = new PathIndex(entries.map((e) => e.path));
  const files = new Map(Object.entries(assets).map(([key, url]) => [relative(key), url]));
  const listeners = new Set<(paths: readonly string[]) => void>();
  const dataListeners = new Set<(delta: CollectionDelta) => void>();
  const changed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let indexValue: CollectionIndex | undefined;
  const hasType = (value: unknown, type: string) => value === type || Array.isArray(value) && value.includes(type);
  const queue = (at: readonly string[]) => {
    for (const path of at) changed.add(path);
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), 50);
  };
  const flush = async (): Promise<Result<void>> => {
    clearTimeout(timer);
    if (!changed.size) return ok(undefined);
    const at = [...changed]; changed.clear();
    let annotations = false, comments = false, libraryChanged = false;
    const sources = new Map(entries.map((e) => [e.path, e]));
    for (const path of at) {
      const record = authority.get(path);
      if (record) paths.add(path); else paths.delete(path);
      const fm = record?.frontmatter;
      if (fm && hasType(fm["type"], "writer-manuscript")) manuscripts.set(path, { path, title: typeof fm["title"] === "string" ? fm["title"] : path });
      else manuscripts.delete(path);
      annotations ||= hasType(fm?.["type"], "reader-annotation") || path.startsWith("annotations/");
      comments ||= hasType(fm?.["type"], "comment") || commentPaths.has(path);
      if (hasType(fm?.["type"], "comment")) commentPaths.add(path); else commentPaths.delete(path);
      const source = fm && libraryEntry(path, fm);
      if (source && JSON.stringify(source) !== JSON.stringify(sources.get(path))) { sources.set(path, source); libraryChanged = true; }
      if (!record && sources.delete(path)) libraryChanged = true;
    }
    if (libraryChanged) { entries = [...sources.values()]; sourcePaths = new PathIndex(entries.map((e) => e.path)); }
    const index = await backend.index();
    for (const listener of dataListeners) listener({ paths: at, ...(index.ok ? { index: index.value } : {}), ...(libraryChanged ? { library: entries } : {}), annotations, comments });
    return ok(undefined);
  };
  const stopWatch = authority.watch.subscribe((change) => {
    const at = [change.payload["path"], change.payload["from"], change.payload["to"]].filter((p): p is string => typeof p === "string");
    for (const listener of listeners) listener(at);
    queue(at);
  });
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

  // The demo's comments and people are records of the starter types, whose
  // fields are the contracts' own names.
  const commentPaths = new Set([...paths].filter((p) => splitFrontmatter(markdown[`../../demo/${p}`] ?? "").frontmatter["type"] === "comment"));
  const names = new Map<string, string>();
  for (const path of paths) {
    const { frontmatter } = splitFrontmatter(markdown[`../../demo/${path}`] ?? "");
    if (frontmatter["type"] === "person" && typeof frontmatter["name"] === "string") names.set(personKey(path), frontmatter["name"]);
  }
  // The demo is written by the manuscript's author.
  const me = [...paths].find((p) => names.get(personKey(p)) === "Callum Alpass");
  const people: People = { names, ...(me ? { me: { link: personLink(me), name: "Callum Alpass" }, signing: { kind: "linked" } } : { signing: { kind: "unlinked" } }) };
  const readComment = async (path: string): Promise<CommentRecord | null> => {
    const opened = await authority.records.open(path, { autosave: false });
    if (!opened.ok) return null;
    const { frontmatter, body } = opened.value.session.getSnapshot();
    opened.value.release();
    return commentFromRecord(path, frontmatter, body);
  };

  // When each manuscript was last written, for the list: a few days before the
  // demo opened, and then when this demo last changed its text.
  const lastWritten = new Map<string, { body: string; modified: string }>();
  const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

  const backend: WriterBackend & { authority: typeof authority } = {
    /** Exposed so browser tests can simulate other applications' edits. */
    authority,
    kind: "demo",
    collectionName: "Demo collection",
    draftNamespace: "demo",

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
        const { body, frontmatter } = opened.value.session.getSnapshot();
        opened.value.release();
        let written = lastWritten.get(m.path);
        if (!written || written.body !== body) {
          written = { body, modified: written ? new Date().toISOString() : daysAgo(lastWritten.size * 4 + 2) };
          lastWritten.set(m.path, written);
        }
        out.push({ ...m, title: typeof frontmatter["title"] === "string" ? frontmatter["title"] : m.title, ...(typeof frontmatter["template"] === "string" ? { template: frontmatter["template"] } : {}), ...(typeof frontmatter["csl"] === "string" ? { style: frontmatter["csl"] } : {}), ...bodySummary(body), modified: written.modified });
      }
      return ok(out.sort((a, b) => a.title.localeCompare(b.title)));
    },
    async createManuscript(input: NewManuscript): Promise<Result<string>> {
      let path = `manuscripts/${manuscriptSlug(input.title)}.md`;
      for (let n = 2; paths.has(path); n++) path = `manuscripts/${manuscriptSlug(input.title)}-${n}.md`;
      const body = manuscriptBody(input.starter, entries[0]?.key);
      authority.seed(path, {
        body,
        frontmatter: { type: "writer-manuscript", title: input.title, template: input.template, csl: input.style },
      });
      paths.add(path);
      manuscripts.set(path, { path, title: input.title, template: input.template, style: input.style });
      lastWritten.set(path, { body, modified: new Date().toISOString() });
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
      lastWritten.set(path, { body, modified: new Date().toISOString() });
      return ok(path);
    },
    async createRecord(path: string, body: string) {
      let at = path;
      for (let n = 2; paths.has(at); n++) at = numberedPath(path, n);
      authority.seed(at, { body, frontmatter: {} });
      paths.add(at);
      queue([at]);
      return ok(at);
    },
    async index(): Promise<Result<CollectionIndex>> {
      const notNotes = new Set(["comment", "person", "reader-annotation", "reader-source"]);
      const notePaths = [...paths].filter((p) => p.endsWith(".md") && ![...notNotes].some((t) => hasType(authority.get(p)?.frontmatter["type"], t)));
      const next = { recordPaths: [...paths], filePaths: [...files.keys()], notePaths };
      if (!indexValue || JSON.stringify(indexValue) !== JSON.stringify(next)) indexValue = next;
      return ok(indexValue);
    },
    async readBody(path: string) {
      const opened = await authority.records.open(path, { autosave: false });
      if (!opened.ok) return fail(opened.problem.message ?? opened.problem.code);
      const { body } = opened.value.session.getSnapshot();
      opened.value.release();
      return ok(body);
    },
    async library() {
      return ok(entries);
    },
    async annotationPaths() {
      return ok([...paths].filter((path) => hasType(authority.get(path)?.frontmatter["type"], "reader-annotation")));
    },
    async annotationsForSource(source) {
      const out = [];
      const candidates = sourcePaths;
      for (const path of paths) {
        const fm = authority.get(path)?.frontmatter;
        if (!hasType(fm?.["type"], "reader-annotation")) continue;
        const record = authority.get(path);
        if (!record || typeof record.frontmatter["source"] !== "string" || resolveLinkTarget(annotationSourceLink(record.frontmatter["source"]) ?? "", path, candidates) !== source) continue;
        const a = sourceAnnotation(path, record.frontmatter, record.body ?? "");
        if (a) out.push(a);
      }
      return ok(out);
    },
    async readFile(path: string) {
      const url = files.get(path);
      if (!url) return fail(`No file at ${path}.`);
      return ok(new Uint8Array(await (await fetch(url)).arrayBuffer()));
    },
    async comments(scope) {
      const out: CommentRecord[] = [];
      const candidates = new PathIndex(paths);
      for (const path of commentPaths) {
        const fm = authority.get(path)?.frontmatter;
        const document = typeof fm?.["document"] === "string" ? resolveLinkTarget(linkPath(fm["document"]), path, candidates) : null;
        if (scope && (!document || !scope.includes(document))) continue;
        const c = await readComment(path);
        if (c) out.push(c);
      }
      return ok(out);
    },
    async createComment(input) {
      const now = new Date();
      const path = commentPath(now);
      const fields = newCommentFields(input, now, people.me?.link);
      authority.seed(path, { frontmatter: { type: "comment", ...fields }, body: input.text.trim() ? `${input.text.trim()}\n` : "" });
      paths.add(path);
      commentPaths.add(path);
      queue([path]);
      const comment = commentFromRecord(path, fields, input.text);
      return comment ? ok(comment) : fail("The comment could not be read back.");
    },
    async changeComment(comment, change) {
      const opened = await authority.records.open(comment.path, { autosave: false });
      if (!opened.ok) return fail(opened.problem.message ?? opened.problem.code);
      const { session, release } = opened.value;
      const { fields, body } = changeFields(comment, change, new Date(), people.me?.link);
      session.patchFrontmatter(fields);
      if (body !== undefined) session.setBody(body);
      const flushed = await session.flush();
      release();
      if (!flushed.ok) return fail(flushed.problem.message ?? flushed.problem.code);
      const next = await readComment(comment.path);
      return next ? ok(next) : fail("The comment could not be read back.");
    },
    async people() {
      return people;
    },
    onCollectionChange(listener) { dataListeners.add(listener); return () => dataListeners.delete(listener); },
    flushChanges: flush,
    async reconcile() {
      indexValue = undefined;
      for (const listener of dataListeners) listener({ paths: [], reset: true });
      return ok(undefined);
    },
    onExternalChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      clearTimeout(timer);
      dataListeners.clear();
      stopWatch();
      stopFollowing();
      authority.watch.close();
      listeners.clear();
    },
  };
  return backend;
}
