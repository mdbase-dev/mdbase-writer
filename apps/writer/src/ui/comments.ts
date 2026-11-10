// Which of the collection's comment threads belong to this manuscript, and
// where each is in its record's current text.
import type { CommentAnchor } from "@mdbase-dev/ui/comment-anchors";
import { commentThreads, linkPath, locate, type CommentRecord, type CommentThread, type PlacedThread as SharedPlacedThread } from "@mdbase-dev/ui/comments";
import { PathIndex, resolveLinkTarget } from "@mdbase-writer/core/records";

/** A thread on one of the manuscript's records. */
export type PlacedThread = SharedPlacedThread & { readonly record: string };

/** A thread shows unless its first comment was withdrawn and nobody replied. */
const shown = (t: CommentThread) => !t.root.deletedAt || t.replies.some((r) => !r.deletedAt);

/**
 * The threads on the manuscript's records, in reading order: by record, then
 * whole-record threads, then by position, then detached threads.
 */
const pathIndexes = new WeakMap<readonly string[], PathIndex>();
function candidatesFor(paths: readonly string[] | ReadonlySet<string>): ReadonlySet<string> {
  if (!Array.isArray(paths)) return paths as ReadonlySet<string>;
  let index = pathIndexes.get(paths);
  if (!index) { index = new PathIndex(paths); pathIndexes.set(paths, index); }
  return index;
}
const position = (p: PlacedThread) => p.at === "whole" ? -1 : p.at === null ? Number.MAX_SAFE_INTEGER : p.at.from;

/** Resolve membership only on metadata changes; anchor only changed manuscript bodies. */
export class ThreadPlacement {
  private comments: readonly CommentRecord[] | undefined;
  private candidates: ReadonlySet<string> | undefined;
  private readonly threads = new Map<string, CommentThread[]>();
  private readonly placed = new Map<string, { body: string; value: PlacedThread[] }>();
  private result: PlacedThread[] = [];

  place(comments: readonly CommentRecord[], order: readonly string[], bodies: (path: string) => string | undefined, paths: readonly string[] | ReadonlySet<string>): PlacedThread[] {
    const candidates = candidatesFor(paths);
    if (comments !== this.comments || candidates !== this.candidates) {
      this.comments = comments;
      this.candidates = candidates;
      this.threads.clear();
      this.placed.clear();
      for (const thread of commentThreads(comments)) {
        if (!shown(thread)) continue;
        const record = resolveLinkTarget(linkPath(thread.root.document), thread.root.path, candidates);
        if (record === null) continue;
        let threads = this.threads.get(record);
        if (!threads) { threads = []; this.threads.set(record, threads); }
        threads.push(thread);
      }
    }
    const rank = new Map(order.map((path, i) => [path, i]));
    const result: PlacedThread[] = [];
    for (const record of rank.keys()) {
      const threads = this.threads.get(record);
      if (!threads) continue;
      const body = bodies(record);
      if (body === undefined) continue;
      let known = this.placed.get(record);
      if (known?.body !== body) {
        const previous = new Map(known?.value.map((p) => [p.thread, p]));
        const value = threads.map((thread): PlacedThread => {
          const at = thread.root.target ? locate(body, thread.root.target) : "whole";
          const old = previous.get(thread);
          return old && JSON.stringify(old.at) === JSON.stringify(at) ? old : { thread, record, at };
        }).sort((a, b) => position(a) - position(b));
        known = { body, value };
        this.placed.set(record, known);
      }
      result.push(...known.value);
    }
    result.sort((a, b) => rank.get(a.record)! - rank.get(b.record)!);
    if (result.length !== this.result.length || result.some((p, i) => p !== this.result[i])) this.result = result;
    return this.result;
  }
}

export function placeThreads(comments: readonly CommentRecord[], order: readonly string[], bodies: (path: string) => string | undefined, recordPaths: readonly string[] | ReadonlySet<string>): PlacedThread[] {
  return new ThreadPlacement().place(comments, order, bodies, recordPaths);
}

/** The editor's anchors for a record: its open, placed threads. */
export function anchorsFor(placed: readonly PlacedThread[], record: string): CommentAnchor[] {
  return placed
    .filter((p) => p.record === record && p.at !== null && p.at !== "whole" && p.thread.root.status === "open" && p.thread.root.target)
    .map(({ thread: { root } }) => ({
      id: root.path,
      target: root.target!,
      ...(root.motivation === "editing" && root.suggestion ? { replacement: root.suggestion.replacement } : {}),
    }));
}
