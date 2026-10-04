// One open record on mdbase-next: the workspace's record session on top of
// `MdbaseClient.update`. Each save sends the view it was edited from, so the
// SDK adds `base` fields and body edits and the replica merges concurrent
// edits instead of the last writer winning.
//
// - A save is accepted when the replica answers `pending` with the optimistic
//   record; it is confirmed later (`Write.confirmed`). The state stays
//   `saving` until then, but the change is no longer `dirty`: the replica has it.
// - A rejected `conflict` receipt, a confirmed receipt whose entry was
//   `conflicted`, and a hold on the record all become the workspace's
//   `conflict` state, with the other side as `remote`.
// - An `outcome_unknown` write is `recovery`: its receipt is looked up by
//   mutation ID before anything else is sent.
import { isMdbaseError, toPlain, type ConflictEntry, type Hold, type MdbaseClient, type PlainValue, type Receipt, type RecordView, type Write } from "@mdbase-dev/sdk";
import type { JsonObject } from "@mdbase-dev/connect";

import { nextProblem, problemFrom, problemFromWire, type NextProblem } from "./next-errors.js";
import type { RecordResolution, RecordSession, RecordSessionSnapshot, RecordSessionState, SessionProblem, SessionRecord } from "./types.js";

const WITH_BODY = { body: true } as const;

export const plainFrontmatter = (view: Pick<RecordView, "frontmatter">): JsonObject => toPlain(view.frontmatter) as JsonObject;

/** Writer's JSON frontmatter as SDK values (JSON is a subset of them). */
export const asPlain = (value: JsonObject): { [key: string]: PlainValue } => value as { [key: string]: PlainValue };

export function sessionRecord(view: RecordView): SessionRecord {
  return { path: view.path, revision: view.revision, types: view.types, frontmatter: plainFrontmatter(view), ...(view.body !== undefined ? { body: view.body } : {}) };
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
const holdText = (value: Hold["mine"] | undefined) => (typeof value === "string" ? value : undefined);

type Outcome = { readonly ok: true } | { readonly ok: false; readonly problem: SessionProblem };

export class NextRecordSession implements RecordSession {
  /** The record the local text descends from (always read with its body). */
  private base: RecordView & { body: string };
  private body: string;
  private patch: JsonObject = {};
  private submitting: Promise<void> | null = null;
  /** Accepted writes waiting for confirmation, with the text each sent. */
  private readonly pending = new Map<Write, string>();
  private remote: RecordView | null = null;
  private conflicts: ConflictEntry[] = [];
  private hold: Hold | null = null;
  private problem: NextProblem | null = null;
  private unknownMutation: string | undefined;
  private deleted = false;
  private stale = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  private disposed = false;
  private current: RecordSessionSnapshot;

  constructor(private readonly client: MdbaseClient, view: RecordView & { body: string }, private readonly idleMs: number | false) {
    this.base = view;
    this.body = view.body;
    this.current = this.compute();
  }

  get id(): string { return this.base.id; }
  get path(): string { return this.base.path; }

  getSnapshot = (): RecordSessionSnapshot => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setBody(body: string): void {
    if (body === this.body) return;
    this.body = body;
    this.edited();
  }

  patchFrontmatter(patch: JsonObject): void {
    this.patch = { ...this.patch, ...patch };
    this.edited();
  }

  /** A newer view from the live query (without a body). */
  receive(view: RecordView): void {
    if (this.disposed) return;
    if (this.deleted) { this.deleted = false; this.emit(); }
    if (view.revision === this.base.revision) {
      if (view.path !== this.base.path) { this.base = { ...this.base, path: view.path }; this.emit(); }
      return;
    }
    // Our own optimistic records come back through the live query too.
    for (const write of this.pending.keys()) if (write.records.some((r) => r.revision === view.revision)) return;
    if (this.dirtyLocally() || this.submitting || this.pending.size || this.remote || this.hold) {
      // Local edits keep their base: the next save merges on the replica.
      this.stale = true;
      return;
    }
    void this.refresh();
  }

  markDeleted(): void {
    if (this.deleted) return;
    this.deleted = true;
    clearTimeout(this.timer);
    this.emit();
  }

  /** A hold the replica placed on this record (or `null` when it is gone). */
  setHold(hold: Hold | null): void {
    if (this.hold?.id === hold?.id && this.hold?.saves === hold?.saves) return;
    const released = this.hold && !hold;
    this.hold = hold;
    this.emit();
    if (released) void this.refresh();
  }

  /** Read the record again; adopt it when there is nothing local to keep. */
  async refresh(): Promise<void> {
    let view: RecordView;
    try { view = await this.client.get(this.base.id, WITH_BODY); }
    catch (error) {
      if (isMdbaseError(error, "not_found")) this.markDeleted();
      return;
    }
    if (this.disposed) return;
    this.stale = false;
    if (this.dirtyLocally() || this.submitting || this.pending.size || this.remote || this.hold) return;
    this.base = withBody(view, view.body ?? "");
    this.body = this.base.body;
    this.patch = {};
    this.emit();
  }

  resolve(choice: RecordResolution): void {
    if (this.hold) {
      const hold = this.hold;
      const how = "body" in choice ? "use" : choice.keep === "mine" ? "keep_mine" : "take_theirs";
      void this.client.resolveHold(hold.id, how, "body" in choice ? choice.body : undefined)
        .then(() => { if (this.hold?.id === hold.id) this.setHold(null); })
        .catch((error: unknown) => { this.problem = problemFrom(error); this.emit(); });
      return;
    }
    const remote = this.remote;
    if (!remote || remote.body === undefined) return;
    const dismissed = this.conflicts;
    this.remote = null;
    this.conflicts = [];
    this.problem = null;
    this.base = withBody(remote, remote.body ?? "");
    if ("body" in choice) this.body = choice.body;
    else if (choice.keep === "theirs") { this.body = this.base.body; this.patch = {}; }
    for (const entry of dismissed) void this.client.dismissConflict(entry).catch(() => {});
    this.emit();
    if (this.dirtyLocally()) void this.save();
  }

  /** Write local changes now (joins a save in flight). */
  save(): Promise<void> {
    clearTimeout(this.timer);
    if (this.submitting) return this.submitting;
    if (this.disposed || this.deleted || this.remote || this.hold) return Promise.resolve();
    if (!this.unknownMutation && !this.dirtyLocally()) return Promise.resolve();
    const job = this.write().finally(() => {
      if (this.submitting === job) this.submitting = null;
      this.emit();
      if (this.dirtyLocally() && !this.problem) this.schedule();
    });
    this.submitting = job;
    this.emit();
    return job;
  }

  async flush(options: { timeoutMs?: number } = {}): Promise<Outcome> {
    const deadline = Date.now() + (options.timeoutMs ?? 15_000);
    for (;;) {
      if (this.deleted) return { ok: false, problem: nextProblem("not_found") };
      if (this.remote || this.hold) return { ok: false, problem: nextProblem("conflict") };
      await this.save();
      if (this.problem) return { ok: false, problem: this.problem };
      if (this.unknownMutation) return { ok: false, problem: nextProblem("outcome_unknown") };
      if (!this.dirtyLocally() && !this.unknownMutation && !this.submitting) return { ok: true };
      if (Date.now() > deadline) return { ok: false, problem: nextProblem("unavailable") };
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.listeners.clear();
  }

  /** Nothing waits to be written or confirmed. */
  get idle(): boolean {
    return !this.dirtyLocally() && !this.submitting && !this.pending.size && !this.unknownMutation;
  }

  private edited(): void {
    if (this.problem && this.problem.recovery !== "wait") this.problem = null;
    this.emit();
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    if (this.idleMs === false || this.disposed) return;
    this.timer = setTimeout(() => void this.save(), this.idleMs);
  }

  private dirtyLocally(): boolean {
    if (this.body !== this.base.body) return true;
    const saved = plainFrontmatter(this.base);
    return Object.entries(this.patch).some(([key, value]) => !same(saved[key], value));
  }

  private async write(): Promise<void> {
    if (this.unknownMutation && !(await this.recover(this.unknownMutation))) return;
    if (!this.dirtyLocally()) return;
    const base = this.base, sentBody = this.body, sentPatch = { ...this.patch };
    let write: Write;
    try {
      write = await this.client.update(base, {
        ...(sentBody !== base.body ? { body: sentBody } : {}),
        ...(Object.keys(sentPatch).length ? { patch: asPlain(sentPatch) } : {}),
      }, { include: WITH_BODY });
    } catch (error) {
      await this.failed(error, undefined);
      return;
    }
    if (write.state === "rejected" || write.state === "unknown") {
      await this.failed(write.receipt.problem ? { wire: write.receipt.problem } : nextProblem(write.state === "unknown" ? "outcome_unknown" : "internal"), write.state === "unknown" ? write.mutationId : undefined);
      return;
    }
    this.problem = null;
    const optimistic = write.records.find((r) => r.id === base.id);
    this.adopt(optimistic ? withBody(optimistic, optimistic.body ?? sentBody) : { ...base, body: sentBody }, sentPatch);
    if (write.state === "confirmed") { void this.confirmed(write.receipt, sentBody); return; }
    this.pending.set(write, sentBody);
    write.confirmed.then(
      (receipt) => { this.pending.delete(write); return this.confirmed(receipt, sentBody); },
      (error: unknown) => { this.pending.delete(write); return this.failed(error, isMdbaseError(error, "outcome_unknown") ? write.mutationId : undefined); },
    ).finally(() => this.emit());
  }

  /** The replica accepted a write: the local text now descends from what it returned. */
  private adopt(view: RecordView & { body: string }, sentPatch: JsonObject): void {
    this.base = view;
    for (const [key, value] of Object.entries(sentPatch)) if (same(this.patch[key], value)) delete this.patch[key];
  }

  private async confirmed(receipt: Receipt, sentBody: string): Promise<void> {
    const conflicts = (receipt.conflicts ?? []).filter((c) => c.id === this.base.id);
    if (receipt.status === "conflicted" && conflicts.length) {
      // The replica kept another side and recorded ours as lost.
      const remote = await this.client.get(this.base.id, WITH_BODY).catch(() => null);
      if (!remote) return;
      this.remote = remote;
      this.conflicts = conflicts.map((conflict) => ({ mutation: receipt.mutation, seq: receipt.seq ?? 0, conflict }));
      if (this.body === this.base.body) this.body = sentBody;
      this.emit();
      return;
    }
    if (this.pending.size || this.submitting) return;
    // A merged result differs from what we sent: take it when nothing was typed since.
    const confirmed = receipt.records?.find((r) => r.id === this.base.id);
    if (!confirmed || confirmed.revision === this.base.revision) {
      if (this.stale && !this.dirtyLocally()) void this.refresh();
      return;
    }
    if (this.dirtyLocally()) return;
    const view = confirmed.body !== undefined ? confirmed : await this.client.get(this.base.id, WITH_BODY).catch(() => null);
    if (!view || this.dirtyLocally() || this.pending.size || this.submitting) return;
    this.base = withBody(view, view.body ?? "");
    this.body = this.base.body;
    this.stale = false;
    this.emit();
  }

  /** Look up an interrupted write's receipt; true when it is safe to write again. */
  private async recover(mutation: string): Promise<boolean> {
    let receipt: Receipt;
    try { receipt = await this.client.receipt(mutation); }
    catch (error) {
      if (isMdbaseError(error, "not_found")) { this.unknownMutation = undefined; return true; } // It never arrived.
      this.problem = problemFrom(error);
      return false;
    }
    if (receipt.state === "unknown") return false;
    this.unknownMutation = undefined;
    if (receipt.state === "rejected") { await this.failed({ wire: receipt.problem }, undefined); return false; }
    const view = await this.client.get(this.base.id, WITH_BODY).catch(() => null);
    if (view) this.base = withBody(view, view.body ?? "");
    this.problem = null;
    return true;
  }

  private async failed(error: unknown, unknownMutation: string | undefined): Promise<void> {
    const problem = isWire(error) ? problemFromWire(error.wire) : isNextProblem(error) ? error : problemFrom(error);
    if (problem.code === "outcome_unknown" && unknownMutation) {
      this.unknownMutation = unknownMutation;
      this.problem = null;
      this.emit();
      this.schedule();
      return;
    }
    // The optimistic record was rolled back: read what the record is now.
    let current: RecordView | null = null;
    try { current = await this.client.get(this.base.id, WITH_BODY); }
    catch (readError) { if (isMdbaseError(readError, "not_found")) { this.markDeleted(); return; } }
    if (problem.code === "not_found") { this.markDeleted(); return; }
    if (problem.code === "conflict" && current) {
      this.remote = current;
      this.problem = null;
    } else {
      if (current && !this.pending.size) this.base = withBody(current, current.body ?? "");
      this.problem = problem;
      if (problem.recovery === "wait") this.retryLater();
    }
    this.emit();
  }

  private retryLater(): void {
    clearTimeout(this.timer);
    if (this.disposed) return;
    this.timer = setTimeout(() => { this.problem = null; void this.save(); }, 5_000);
  }

  private compute(): RecordSessionSnapshot {
    const remote = this.hold
      ? { path: this.base.path, revision: this.base.revision, types: this.base.types, frontmatter: plainFrontmatter(this.base), body: holdText(this.hold.theirs) ?? this.base.body }
      : this.remote ? sessionRecord(this.remote) : null;
    const local = this.dirtyLocally();
    const state: RecordSessionState = this.deleted ? "deleted"
      : remote ? "conflict"
      : this.unknownMutation ? "recovery"
      : this.problem ? "error"
      : this.submitting || this.pending.size ? "saving"
      : local ? "unsaved" : "saved";
    return {
      state,
      body: this.body,
      frontmatter: { ...plainFrontmatter(this.base), ...this.patch },
      record: sessionRecord(this.base),
      remote,
      dirty: local || Boolean(this.submitting) || Boolean(this.unknownMutation),
      problem: this.problem,
    };
  }

  private emit(): void {
    if (this.disposed) return;
    this.current = this.compute();
    for (const listener of [...this.listeners]) listener();
  }
}

function withBody(view: RecordView, body: string): RecordView & { body: string } {
  return { ...view, body };
}

function isWire(value: unknown): value is { wire: { code: string; reason?: string } | undefined } {
  return typeof value === "object" && value !== null && "wire" in value;
}

function isNextProblem(value: unknown): value is NextProblem {
  return typeof value === "object" && value !== null && "recovery" in value && "code" in value && !(value instanceof Error);
}
