// A self-contained demo collection on the SDK's in-memory record authority:
// real record sessions (autosave, conflicts, recovery) without an account.
// Loaded only in development builds.
import type { JsonObject } from "@mdbase-dev/connect";
import { createRecordTestAuthority } from "@mdbase-dev/connect-testing";
import type { CslItem } from "@mdbase-writer/core";
import { commentFromRecord, type CommentRecord } from "@mdbase-writer/core/comments";
import { splitFrontmatter } from "@mdbase-writer/core/records";
import { CollectionStore, starterSchema, type CollectionRow } from "./collection.js";

import { changeFields, commentPath, newCommentFields, personKey, personLink, type People } from "./comments.js";
import { manuscriptBody, bodySummary, fail, manuscriptSlug, numberedPath, ok, sourceAnnotation, titleFromNote, withType, type CollectionDelta, type CollectionIndex, type ManuscriptSummary, type NewManuscript, type Result, type WriterBackend } from "./types.js";

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
  const store = new CollectionStore(starterSchema());
  // Give the demo's CSL-only sources ordinary rows, like the large/Connect demo.
  for (const item of library) {
    const path = `sources/${item.id}.md`, existing = authority.get(path);
    authority.seed(path, { body: existing?.body ?? "", frontmatter: { ...existing?.frontmatter, type: "reader-source", csl: item as JsonObject } });
    paths.add(path);
  }
  const rowAt = (path: string): CollectionRow | undefined => {
    const record = authority.get(path);
    if (!record) return undefined;
    const type = record.frontmatter["type"];
    const types = Array.isArray(type) ? type.filter((t): t is string => typeof t === "string") : typeof type === "string" ? [type] : [];
    return { ...record, types };
  };
  store.upsert([...paths].map((p) => rowAt(p)!));
  const files = new Map(Object.entries(assets).map(([key, url]) => [relative(key), url]));
  const listeners = new Set<(paths: readonly string[]) => void>();
  const dataListeners = new Set<(delta: CollectionDelta) => void>();
  const changed = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  store.files([...files.keys()]);
  const queue = (at: readonly string[]) => {
    for (const path of at) changed.add(path);
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), 50);
  };
  const flush = async (): Promise<Result<void>> => {
    clearTimeout(timer);
    if (!changed.size) return ok(undefined);
    const at = [...changed]; changed.clear();
    const rows: CollectionRow[] = [], missing: string[] = [];
    for (const path of at) {
      const row = rowAt(path);
      if (row) { paths.add(path); rows.push(row); } else { paths.delete(path); missing.push(path); }
    }
    const upsert = store.upsert(rows), removed = store.remove(missing);
    for (const listener of dataListeners) listener({ ...upsert, ...removed, paths: at });
    return ok(undefined);
  };
  const stopWatch = authority.watch.subscribe((change) => {
    const at = [change.payload["path"], change.payload["from"], change.payload["to"]].filter((p): p is string => typeof p === "string");
    for (const listener of listeners) listener(at);
    queue(at);
  });
  const names = store.people;
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
      for (const m of store.manuscripts) {
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
      const body = manuscriptBody(input.starter, store.library[0]?.key);
      authority.seed(path, {
        body,
        frontmatter: { type: "writer-manuscript", title: input.title, template: input.template, csl: input.style },
      });
      paths.add(path);
      store.upsert([rowAt(path)!]);
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
      store.upsert([rowAt(path)!]);
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
    async index(): Promise<Result<CollectionIndex>> { return ok(store.index); },
    async readBody(path: string) {
      const opened = await authority.records.open(path, { autosave: false });
      if (!opened.ok) return fail(opened.problem.message ?? opened.problem.code);
      const { body } = opened.value.session.getSnapshot();
      opened.value.release();
      return ok(body);
    },
    async library() {
      return ok(store.library);
    },
    async annotationPaths() {
      return ok([...store.annotations.keys()]);
    },
    async annotationsForSource(source) {
      const out = [];
      for (const path of store.annotationsForSource(source).keys()) {
        const record = authority.get(path);
        if (!record) continue;
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
      for (const path of store.commentScope(scope)) {
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
      store.reset();
      store.upsert([...paths].flatMap((p) => { const row = rowAt(p); return row ? [row] : []; }));
      store.files([...files.keys()]);
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
