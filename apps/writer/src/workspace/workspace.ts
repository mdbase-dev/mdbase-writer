// One open manuscript: its record sessions, the compile worker, and a single
// snapshot the UI renders from.
//
// The manuscript and each record it embeds get their own record session
// (autosave, conflict detection, exact recovery — all from the SDK). Every
// content change is forwarded to the worker, which assembles and typesets
// the whole manuscript and reports which embedded records it still needs.
import type { JsonObject, MdbaseRecordLease, MdbaseRecordSessionSnapshot, RecordDocument } from "@mdbase-dev/connect";
import { STYLES, type CslItem } from "@mdbase-writer/core";

import type { LibraryEntry, WriterBackend } from "../backend/types.js";
import { CompileClient } from "../compile/client.js";
import type { CompileResult } from "../compile/protocol.js";

const styleFiles = import.meta.glob("../../../../packages/core/assets/csl/*.csl", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const localeXml = (import.meta.glob("../../../../packages/core/assets/csl/locales-en-US.xml", { query: "?raw", import: "default", eager: true }) as Record<string, string>)[
  "../../../../packages/core/assets/csl/locales-en-US.xml"
] ?? "";

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
  readonly library: readonly LibraryEntry[];
  readonly recordPaths: readonly string[];
  readonly compiling: boolean;
}

export class ManuscriptWorkspace {
  private readonly compile = new CompileClient();
  private readonly leases = new Map<string, { lease: MdbaseRecordLease<JsonObject>; unsubscribe: () => void }>();
  private readonly opening = new Set<string>();
  private readonly sent = new Map<string, string>();
  private readonly requestedAssets = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly cleanups: (() => void)[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private current: WorkspaceSnapshot;
  private disposed = false;

  constructor(
    private readonly backend: WriterBackend,
    readonly main: string,
  ) {
    this.current = { main, phase: "loading", records: new Map(), library: [], recordPaths: [], compiling: true };
    this.cleanups.push(this.compile.onResult((r) => this.onResult(r)));
    this.cleanups.push(this.compile.onFailure((message) => this.update({ problem: message })));
    this.cleanups.push(backend.onExternalChange((paths) => this.onExternalChange(paths)));
    void this.start();
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
    const [index, library] = await Promise.all([this.backend.index(), this.backend.library()]);
    if (!index.ok || !library.ok) {
      this.update({ phase: "failed", problem: !index.ok ? index.message : library.ok ? "" : library.message });
      return;
    }
    const items = library.value.map((e) => e.item);
    this.compile.send({
      type: "init",
      library: items,
      styles: STYLES.map((s) => [s.id, styleFiles[`../../../../packages/core/assets/csl/${s.id}.csl`] ?? ""] as [string, string]),
      locale: localeXml,
      baseUrl: import.meta.env.BASE_URL,
    });
    this.compile.send({ type: "collection", recordPaths: index.value.recordPaths, filePaths: index.value.filePaths });
    this.compile.send({ type: "main", path: this.main });
    this.update({ library: library.value, recordPaths: [...index.value.recordPaths] });
    const opened = await this.open(this.main);
    this.update({ phase: opened ? "ready" : "failed" });
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
    this.update({ records });
    // Forward only content changes; save-state transitions don't need a compile.
    const key = `${snapshot.body}\u0000${JSON.stringify(snapshot.frontmatter)}`;
    if (this.sent.get(path) === key) return;
    this.sent.set(path, key);
    this.update({ compiling: true });
    this.compile.send({ type: "records", upsert: [{ path, body: snapshot.body, frontmatter: snapshot.frontmatter }] });
  }

  private onResult(result: CompileResult): void {
    this.update({ result, compiling: false, ...(result.artifact ? { artifact: result.artifact } : {}) });
    for (const path of result.unloaded) void this.open(path);
    const wanted = result.neededAssets.filter((a) => !this.requestedAssets.has(a));
    for (const a of wanted) this.requestedAssets.add(a);
    if (wanted.length) void this.loadAssets(wanted);
  }

  private async loadAssets(paths: readonly string[]): Promise<void> {
    const files: [string, Uint8Array][] = [];
    for (const path of paths) {
      const read = await this.backend.readFile(path);
      if (read.ok) files.push([path, read.value]);
    }
    if (files.length) this.compile.send({ type: "assets", files }, files.map(([, b]) => b.buffer as ArrayBuffer));
  }

  private onExternalChange(paths: readonly string[]): void {
    if (paths.every((p) => this.leases.has(p))) return; // record sessions follow their own records
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.refreshCollection(), 2_000);
  }

  private async refreshCollection(): Promise<void> {
    const [index, library] = await Promise.all([this.backend.index(), this.backend.library()]);
    if (index.ok) {
      this.compile.send({ type: "collection", recordPaths: index.value.recordPaths, filePaths: index.value.filePaths });
      this.update({ recordPaths: [...index.value.recordPaths] });
    }
    if (library.ok) {
      this.compile.send({ type: "library", library: library.value.map((e) => e.item) as CslItem[] });
      this.update({ library: library.value });
    }
  }

  setBody(path: string, body: string): void {
    this.leases.get(path)?.lease.session.setBody(body);
  }

  patchFrontmatter(path: string, patch: JsonObject): void {
    this.leases.get(path)?.lease.session.patchFrontmatter(patch);
  }

  resolveConflict(path: string, keep: "mine" | "theirs"): void {
    this.leases.get(path)?.lease.session.resolve({ keep });
  }

  exportPdf(): Promise<{ bytes?: Uint8Array; error?: string }> {
    return this.compile.exportPdf();
  }

  /** Saves what is left, then releases every session and stops the worker. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.refreshTimer);
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
