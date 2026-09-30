// One open manuscript: its record sessions, the compile worker, and a single
// snapshot the UI renders from.
//
// The manuscript and each record it embeds get their own record session
// (autosave, conflict detection, exact recovery — all from the SDK). Every
// content change is forwarded to the worker, which assembles and typesets
// the whole manuscript and reports which embedded records it still needs.
import type { JsonObject, MdbaseRecordLease, MdbaseRecordSessionSnapshot, RecordDocument } from "@mdbase-dev/connect";
import type { CslItem, WriterRecord } from "@mdbase-writer/core";
import { applySuggestion, bodyHash, linkPath, targetFor, type CommentRecord, type CommentThread } from "@mdbase-writer/core/comments";
import { BUNDLE_README, materialize } from "@mdbase-writer/core/materialize";
import { resolveLinkTarget } from "@mdbase-writer/core/records";
import { LOCALES, STYLES } from "@mdbase-writer/core/styles";

import { NO_PEOPLE, type CommentChange, type People } from "../backend/comments.js";
import { fail, manuscriptSlug, ok, type LibraryEntry, type Result, type WriterBackend } from "../backend/types.js";
import { CompileClient } from "../compile/client.js";
import type { CompileResult } from "../compile/protocol.js";
import { toDocx } from "../export/pandoc.js";
import { zip } from "../export/zip.js";
import { appendEmbed, chapterEmbeds, moveEmbed } from "./chapters.js";

// Styles and locales are fetched, not bundled: only the worker needs most of them.
const cslUrls = import.meta.glob("../../../../packages/core/assets/csl/*.{csl,xml}", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const cslUrl = (file: string) => cslUrls[`../../../../packages/core/assets/csl/${file}`] ?? "";
let stylesPromise: Promise<{ styles: Map<string, string>; locales: Map<string, string> }> | undefined;
function loadStyles() {
  stylesPromise ??= (async () => {
    const text = (url: string) => fetch(url).then((r) => r.text());
    const [styles, locales] = await Promise.all([
      Promise.all(STYLES.map((s) => text(cslUrl(`${s.id}.csl`)))),
      Promise.all(LOCALES.map((l) => text(cslUrl(`locales-${l}.xml`)))),
    ]);
    return {
      styles: new Map(STYLES.map((s, i) => [s.id, styles[i] ?? ""])),
      locales: new Map(LOCALES.map((l, i) => [l, locales[i] ?? ""])),
    };
  })();
  return stylesPromise;
}

export type SessionSnapshot = MdbaseRecordSessionSnapshot<RecordDocument<JsonObject>>;

export interface RecordView {
  readonly path: string;
  readonly snapshot: SessionSnapshot;
}

export interface WorkspaceSnapshot {
  readonly main: string;
  readonly phase: "loading" | "ready" | "failed";
  readonly problem?: string;
  readonly records: ReadonlyMap<string, RecordView>;
  readonly result?: CompileResult;
  /** The latest artifact that compiled (kept while later edits have errors). */
  readonly artifact?: Uint8Array;
  readonly artifactRevision?: number;
  readonly library: readonly LibraryEntry[];
  readonly recordPaths: readonly string[];
  readonly filePaths: readonly string[];
  readonly compiling: boolean;
  /** Every comment in the collection; the UI keeps those on this manuscript's records. */
  readonly comments: readonly CommentRecord[];
  /** Why comments could not be loaded (a collection not set up for them, say). */
  readonly commentsProblem?: string | undefined;
  readonly people: People;
}

/** A passage chosen to comment on: the body it was chosen in and its UTF-16 range. */
export interface CommentDraft {
  readonly record: string;
  readonly body: string;
  readonly from: number;
  readonly to: number;
}

export class ManuscriptWorkspace {
  private readonly compile = new CompileClient();
  private readonly leases = new Map<string, { lease: MdbaseRecordLease<JsonObject>; unsubscribe: () => void }>();
  private readonly opening = new Set<string>();
  private readonly sent = new Map<string, string>();
  private readonly requestedAssets = new Set<string>();
  /** Collection text files loaded for the settings (a .csl style, a .typ template). */
  private readonly texts = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: (() => void)[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private commentsTimer: ReturnType<typeof setTimeout> | undefined;
  private current: WorkspaceSnapshot;
  private disposed = false;

  constructor(
    private readonly backend: WriterBackend,
    readonly main: string,
  ) {
    this.current = { main, phase: "loading", records: new Map(), library: [], recordPaths: [], filePaths: [], compiling: true, comments: [], people: NO_PEOPLE };
    this.cleanups.push(this.compile.onResult((r) => this.onResult(r)));
    this.cleanups.push(this.compile.onFailure((message) => this.update({ problem: message })));
    this.cleanups.push(backend.onExternalChange((paths) => this.onExternalChange(paths)));
    // Linking a person record happens in another tab (mdbase Editor): look again on return.
    if (typeof window !== "undefined") {
      const onFocus = () => {
        if (this.current.people.signing?.kind === "linked" || Date.now() - this.peopleCheckedAt < 5_000) return;
        void this.refreshPeople();
      };
      window.addEventListener("focus", onFocus);
      this.cleanups.push(() => window.removeEventListener("focus", onFocus));
    }
    void this.start();
  }

  /** Whether this is a real collection or the demo. */
  get kind(): WriterBackend["kind"] {
    return this.backend.kind;
  }

  getSnapshot = (): WorkspaceSnapshot => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private update(patch: Partial<WorkspaceSnapshot>): void {
    if (this.disposed) return;
    this.current = { ...this.current, ...patch };
    for (const l of this.listeners) l();
  }

  private async start(): Promise<void> {
    const [index, library, csl] = await Promise.all([this.backend.index(), this.backend.library(), loadStyles()]);
    if (!index.ok || !library.ok) {
      this.update({ phase: "failed", problem: !index.ok ? index.message : library.ok ? "" : library.message });
      return;
    }
    const items = library.value.map((e) => e.item);
    this.compile.send({
      type: "init",
      library: items,
      styles: [...csl.styles],
      locales: [...csl.locales],
      baseUrl: import.meta.env.BASE_URL,
    });
    this.compile.send({ type: "collection", recordPaths: index.value.recordPaths, filePaths: index.value.filePaths });
    this.compile.send({ type: "main", path: this.main });
    this.update({ library: library.value, recordPaths: [...index.value.recordPaths], filePaths: [...index.value.filePaths] });
    const opened = await this.open(this.main);
    this.update({ phase: opened ? "ready" : "failed" });
    if (opened) void this.loadComments();
  }

  private peopleCheckedAt = 0;

  /** Checks the account against the collection's person records again. */
  async refreshPeople(): Promise<void> {
    this.peopleCheckedAt = Date.now();
    this.update({ people: await this.backend.people({ fresh: true }) });
  }

  /** Asks Connect to approve Writer again (to allow the identity permission), then checks the account. */
  async reviewIdentityAccess(): Promise<Result<void>> {
    if (!this.backend.reviewIdentityAccess) return fail("Writer cannot ask for access here.");
    const reviewed = await this.backend.reviewIdentityAccess();
    if (reviewed.ok) await this.refreshPeople();
    return reviewed;
  }

  private async loadComments(): Promise<void> {
    this.peopleCheckedAt = Date.now();
    const [comments, people] = await Promise.all([this.backend.comments(), this.backend.people()]);
    this.update(comments.ok ? { comments: comments.value, commentsProblem: undefined, people } : { commentsProblem: comments.message, people });
  }

  /** Opens (once) and follows the session for a record. */
  private async open(path: string): Promise<boolean> {
    if (this.leases.has(path) || this.opening.has(path)) return true;
    this.opening.add(path);
    const opened = await this.backend.records.open(path, { autosave: { idleMs: 1_000 }, timeoutMs: 15_000 });
    this.opening.delete(path);
    if (!opened.ok) {
      if (path === this.main) this.update({ problem: opened.problem.message ?? opened.problem.code });
      return false;
    }
    if (this.disposed) {
      opened.value.release();
      return false;
    }
    const { session } = opened.value;
    const unsubscribe = session.subscribe(() => this.onSession(path, session.getSnapshot()));
    this.leases.set(path, { lease: opened.value, unsubscribe });
    this.onSession(path, session.getSnapshot());
    return true;
  }

  private onSession(path: string, snapshot: SessionSnapshot): void {
    const records = new Map(this.current.records);
    records.set(path, { path, snapshot });
    // Forward only content changes; save-state transitions don't need a compile.
    const key = `${snapshot.body}\u0000${JSON.stringify(snapshot.frontmatter)}`;
    if (this.sent.get(path) === key) {
      this.update({ records });
      return;
    }
    this.sent.set(path, key);
    // One update per edit: each re-renders the whole workspace.
    this.update({ records, compiling: true });
    this.compile.send({ type: "records", upsert: [{ path, body: snapshot.body, frontmatter: snapshot.frontmatter }] });
  }

  private onResult(result: CompileResult): void {
    this.update({ result, compiling: false, ...(result.artifact ? { artifact: result.artifact, artifactRevision: result.revision } : {}) });
    for (const path of result.unloaded) void this.open(path);
    const wanted = result.neededAssets.filter((a) => !this.requestedAssets.has(a));
    for (const a of wanted) this.requestedAssets.add(a);
    if (wanted.length) void this.loadAssets(wanted);
  }

  private async loadAssets(paths: readonly string[]): Promise<void> {
    const files: [string, Uint8Array][] = [];
    for (const path of paths) {
      const read = await this.backend.readFile(path);
      if (!read.ok) continue;
      if (/\.(csl|typ)$/i.test(path)) this.texts.set(path, new TextDecoder().decode(read.value));
      files.push([path, read.value]);
    }
    if (files.length) this.compile.send({ type: "assets", files }, files.map(([, b]) => b.buffer as ArrayBuffer));
  }

  private onExternalChange(paths: readonly string[]): void {
    // An image, style or template the document uses changed: send its new bytes.
    const assets = paths.filter((p) => this.requestedAssets.has(p));
    if (assets.length) void this.loadAssets(assets);
    // A comment changed elsewhere (or our own write, echoed): only comments need reloading.
    const comments = new Set(this.current.comments.map((c) => c.path));
    if (paths.some((p) => comments.has(p))) {
      clearTimeout(this.commentsTimer);
      this.commentsTimer = setTimeout(() => void this.loadComments(), 300);
    }
    // Record sessions follow their own records (including ones still opening).
    if (paths.every((p) => this.leases.has(p) || this.opening.has(p) || this.requestedAssets.has(p) || comments.has(p))) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refreshCollection(), 2_000);
  }

  private async refreshCollection(): Promise<void> {
    const [index, library] = await Promise.all([this.backend.index(), this.backend.library()]);
    if (index.ok) {
      this.compile.send({ type: "collection", recordPaths: index.value.recordPaths, filePaths: index.value.filePaths });
      this.update({ recordPaths: [...index.value.recordPaths], filePaths: [...index.value.filePaths] });
    }
    if (library.ok) {
      this.compile.send({ type: "library", library: library.value.map((e) => e.item) as CslItem[] });
      this.update({ library: library.value });
    }
    // A path we did not know may be someone's new comment.
    await this.loadComments();
  }

  setBody(path: string, body: string): void {
    this.leases.get(path)?.lease.session.setBody(body);
  }

  /** The record each of the manuscript's chapter embeds resolves to (null when none does), in order. */
  chapterPaths(): (string | null)[] {
    const body = this.current.records.get(this.main)?.snapshot.body ?? "";
    const candidates = new Set(this.current.recordPaths);
    return chapterEmbeds(body).map((e) => resolveLinkTarget(e.target, this.main, candidates));
  }

  /** Moves the manuscript's chapter embed at index `from` to index `to`. */
  moveChapter(from: number, to: number): void {
    const body = this.current.records.get(this.main)?.snapshot.body;
    if (body !== undefined) this.setBody(this.main, moveEmbed(body, from, to));
  }

  /**
   * Creates a record for a new chapter beside the existing chapters (or in
   * chapters/) and embeds it after the last one. Resolves to its path.
   */
  async addChapter(title: string): Promise<Result<string>> {
    const name = title.trim();
    if (!name) return fail("A chapter needs a title.");
    const first = this.chapterPaths().find((p): p is string => Boolean(p));
    const folder = first?.includes("/") ? first.slice(0, first.lastIndexOf("/")) : "chapters";
    const created = await this.backend.createRecord(`${folder}/${manuscriptSlug(name)}.md`, `# ${name}\n\n`);
    if (!created.ok) return created;
    const path = created.value;
    // The index learns the new record (no need to list the collection again), so the embed resolves.
    const recordPaths = [...this.current.recordPaths, path];
    this.update({ recordPaths });
    this.compile.send({ type: "collection", recordPaths, filePaths: this.current.filePaths });
    // Its session opens now, rather than once the manuscript has been typeset with the embed.
    const opened = this.open(path);
    const body = this.current.records.get(this.main)?.snapshot.body ?? "";
    this.setBody(this.main, appendEmbed(body, path.replace(/\.md$/i, "")));
    await opened;
    return ok(path);
  }

  patchFrontmatter(path: string, patch: JsonObject): void {
    this.leases.get(path)?.lease.session.patchFrontmatter(patch);
  }

  /** A new thread on a passage (a suggestion when `replacement` is given), or on the whole record. */
  async addComment(draft: CommentDraft | { record: string }, text: string, replacement?: string): Promise<Result<CommentRecord>> {
    const target = "body" in draft ? targetFor(draft.body, draft.from, draft.to, await bodyHash(draft.body)) : undefined;
    const created = await this.backend.createComment({ document: draft.record, text, ...(target ? { target } : {}), ...(replacement !== undefined ? { replacement } : {}) });
    if (created.ok) this.update({ comments: [...this.current.comments, created.value] });
    return created;
  }

  async reply(thread: CommentThread, text: string): Promise<Result<CommentRecord>> {
    // A reply repeats its thread's document.
    const document = resolveLinkTarget(linkPath(thread.root.document), thread.root.path, new Set(this.current.recordPaths)) ?? linkPath(thread.root.document);
    const created = await this.backend.createComment({ document, text, thread: thread.root });
    if (created.ok) this.update({ comments: [...this.current.comments, created.value] });
    return created;
  }

  async changeComment(comment: CommentRecord, change: CommentChange): Promise<Result<CommentRecord>> {
    const changed = await this.backend.changeComment(comment, change);
    if (changed.ok) this.update({ comments: this.current.comments.map((c) => (c.path === comment.path ? changed.value : c)) });
    return changed;
  }

  /**
   * Makes a suggestion's edit in the record it is on, then resolves it as
   * accepted. Refuses, leaving it open, when its text is no longer there.
   */
  async acceptSuggestion(record: string, suggestion: CommentRecord): Promise<Result<CommentRecord>> {
    const body = this.current.records.get(record)?.snapshot.body;
    if (body === undefined || !suggestion.target || !suggestion.suggestion) return fail("That record is not open.");
    const next = applySuggestion(body, suggestion.target, suggestion.suggestion.replacement);
    if (next === null) return fail("The suggested text is no longer in the record; edit it by hand, then resolve the suggestion.");
    this.setBody(record, next);
    return this.changeComment(suggestion, { kind: "resolve", outcome: "accepted" });
  }

  resolveConflict(path: string, keep: "mine" | "theirs"): void {
    this.leases.get(path)?.lease.session.resolve({ keep });
  }

  private annotationsPromise: ReturnType<WriterBackend["annotations"]> | undefined;
  /** Reader annotations, loaded once per open manuscript (on first use). */
  annotations = (): ReturnType<WriterBackend["annotations"]> => {
    this.annotationsPromise ??= this.backend.annotations();
    return this.annotationsPromise;
  };

  exportPdf(): Promise<{ bytes?: Uint8Array; error?: string }> {
    return this.compile.exportPdf();
  }

  private async materialize(crossReferences: "quarto" | "resolved") {
    const snap = this.current;
    const records = new Map<string, WriterRecord>(
      [...snap.records].map(([path, r]) => [path, { path, body: r.snapshot.body, frontmatter: r.snapshot.frontmatter }]),
    );
    const { styles, locales } = await loadStyles();
    const out = materialize({
      main: this.main,
      records,
      recordPaths: new Set(snap.recordPaths),
      filePaths: new Set(snap.filePaths),
      library: new Map(snap.library.map((e) => [e.key, e.item])),
      styles,
      locales,
      texts: this.texts,
      crossReferences,
    });
    const problems = [...out.problems];
    const media: [string, Uint8Array][] = [];
    for (const [collectionPath, bundled] of out.media) {
      const read = await this.backend.readFile(collectionPath);
      if (read.ok) media.push([bundled, read.value]);
      else problems.push(`${collectionPath}: ${read.message}`);
    }
    return { out, media, problems };
  }

  /**
   * A Pandoc/Quarto bundle (zip): the manuscript as one Markdown file with
   * embeds inlined, the cited sources as CSL-JSON, the style and the images.
   */
  async exportBundle(): Promise<{ bytes: Uint8Array; problems: readonly string[] }> {
    const { out, media, problems } = await this.materialize("quarto");
    const files: [string, Uint8Array | string][] = [
      ["manuscript.md", out.markdown],
      ["references.json", `${JSON.stringify(out.references, null, 2)}\n`],
      ["style.csl", out.styleXml],
      ["README.md", BUNDLE_README],
      ...media,
    ];
    return { bytes: zip(files), problems };
  }

  /**
   * A Word document, made in the browser by Pandoc: cross-references are
   * resolved to text, citations formatted by Pandoc's citeproc with the same
   * style, and the layout's reference document supplies the Word styles.
   */
  async exportDocx(): Promise<{ bytes?: Uint8Array; error?: string; problems: readonly string[] }> {
    const { out, media, problems } = await this.materialize("resolved");
    const template = this.current.result?.meta.customTemplate ? "article" : (this.current.result?.meta.template ?? "article");
    // The layout's Word styles (public/docx, from scripts/reference-docx.mjs).
    const referenceResponse = await fetch(`${import.meta.env.BASE_URL}docx/${template}.docx`);
    const reference = referenceResponse.ok ? new Uint8Array(await referenceResponse.arrayBuffer()) : undefined;
    const converted = await toDocx(out.markdown, [
      ["references.json", JSON.stringify(out.references)],
      ["style.csl", out.styleXml],
      ...(reference ? [["reference.docx", reference] as const] : []),
      ...media,
    ]);
    if (converted.error !== undefined) return { error: converted.error, problems };
    return { bytes: converted.bytes, problems: [...problems, ...converted.warnings] };
  }

  /** Saves what is left, then releases every session and stops the worker. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.refreshTimer);
    clearTimeout(this.commentsTimer);
    for (const c of this.cleanups) c();
    await Promise.all([...this.leases.values()].map(async ({ lease, unsubscribe }) => {
      unsubscribe();
      await lease.session.flush();
      lease.release();
    }));
    this.leases.clear();
    this.compile.terminate();
  }
}
