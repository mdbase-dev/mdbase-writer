import { isMdbaseError, toPlain, type MdbaseClient, type PlainValue, type RecordOpenOptions as NativeOpenOptions, type RecordSessionSnapshot as NativeSnapshot, type wire } from "@mdbase-dev/sdk";
import type { JsonObject } from "@mdbase-dev/connect";

import type { RecordLease, RecordOpenOptions, RecordSession, RecordSessionSnapshot, SessionProblem, SessionRecord, WriterRecords } from "./types.js";

export interface NextWriterSession extends RecordSession {
  /** Genuine SDK recovery/MID/receipt/write evidence. Never reconstruct it from
   * the app's display-only JSON snapshot or manufacture a replacement intent. */
  getNativeSnapshot(): NativeSnapshot;
}

export interface NextWriterLease extends RecordLease {
  readonly session: NextWriterSession;
}

export type NextWriterOpenOptions = RecordOpenOptions & Pick<NativeOpenOptions, "recovery">;

/** Thin application value/Result translation over the public SDK lease. No
 * app autosave, session factory, protocol, receipt/recovery or lease engine. */
export class NextWriterRecords implements WriterRecords {
  constructor(private readonly client: Pick<MdbaseClient, "records">, private readonly signal: AbortSignal) {}

  async open(path: string, options: NextWriterOpenOptions = {}): Promise<
    { readonly ok: true; readonly value: NextWriterLease } |
    { readonly ok: false; readonly problem: { readonly code: string; readonly message?: string } }
  > {
    try {
      this.signal.throwIfAborted();
      const lease = await this.client.records.open({ path }, { ...options, signal: this.signal });
      if (this.signal.aborted) {
        lease.release();
        this.signal.throwIfAborted();
      }
      const native = lease.session;
      return { ok: true, value: {
        release: () => lease.release(),
        session: {
          getNativeSnapshot: () => native.getSnapshot(),
          getSnapshot: () => snapshot(native.getSnapshot()),
          subscribe: listener => native.subscribe(listener),
          setBody: body => native.setBody(body),
          patchFrontmatter: patch => native.patchFrontmatter(Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value === undefined ? undefined : plain(value)]))),
          resolve: choice => native.resolve(choice),
          flush: async flushOptions => {
            try {
              this.signal.throwIfAborted();
              const result = await native.flush({ ...flushOptions, signal: this.signal });
              this.signal.throwIfAborted();
              return result.ok ? { ok: true } : { ok: false, problem: result.problem };
            } catch (error) {
              return { ok: false, problem: problem(error, this.signal) };
            }
          },
        },
      } };
    } catch (error) {
      return { ok: false, problem: problem(error, this.signal) };
    }
  }
}

function problem(error: unknown, signal: AbortSignal): SessionProblem {
  return isMdbaseError(error) ? error.toProblem() : {
    code: signal.aborted ? "cancelled" : "internal",
    message: error instanceof Error ? error.message : "The native Writer record operation could not complete.",
  };
}

// Copy the explicit JSON patch into the public SDK's mutable plain value type;
// preserve scalar values rather than serializing/round-tripping through JSON.
function plain(value: unknown): PlainValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(plain);
  if (typeof value === "object" && value !== null && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return new Map(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  }
  throw new TypeError("Writer frontmatter patches require plain JSON values.");
}

function record(view: wire.RecordView): SessionRecord {
  return {
    path: view.path,
    revision: view.revision,
    types: view.types,
    // Display/edit view only. Native session keeps the exact Map/tag values and
    // genuine full record witness; writes only receive the explicit app patch.
    frontmatter: toPlain(view.frontmatter) as JsonObject,
    ...(view.body === undefined ? {} : { body: view.body }),
  };
}

function snapshot(value: NativeSnapshot): RecordSessionSnapshot {
  return {
    state: value.state,
    body: value.body,
    frontmatter: toPlain(new Map(value.frontmatter)) as JsonObject,
    record: record(value.record),
    remote: value.remote ? record(value.remote) : null,
    dirty: value.dirty,
    problem: value.problem,
  };
}
