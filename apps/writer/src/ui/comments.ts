// Which of the collection's comment threads belong to this manuscript, and
// where each is in its record's current text.
import { commentThreads, linkPath, locate, type CommentRecord, type CommentThread, type Located } from "@mdbase-writer/core/comments";
import { PathIndex, resolveLinkTarget } from "@mdbase-writer/core/records";

import type { CommentAnchor } from "../editor/comments.js";

export interface PlacedThread {
  readonly thread: CommentThread;
  readonly record: string;
  /** Where its passage is now: "whole" for a comment on the whole record, null when detached. */
  readonly at: Located | "whole" | null;
}

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
        const value = threads.map((thread): PlacedThread => ({ thread, record, at: thread.root.target ? locate(body, thread.root.target) : "whole" })).sort((a, b) => position(a) - position(b));
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

/** A passage on one line, shortened to about 60 characters. */
/**
 * A passage of Markdown as it reads: emphasis, code and link markup dropped,
 * soft line breaks as spaces ("*modal picture*" → "modal picture").
 */
export function plainPassage(passage: string): string {
  return passage
    .replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1")
    .replace(/\[\[(?:[^\]|\n]*\|)?([^\]\n]*)\]\]/g, "$1")
    .replace(/(\*\*|__)(?=\S)([^\n]*?\S)\1/g, "$2")
    .replace(/\*(?=\S)([^*\n]*?\S)\*/g, "$1")
    .replace(/(?<![\p{L}\p{N}])_(?=\S)([^_\n]*?\S)_(?![\p{L}\p{N}])/gu, "$1")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/([^\n])\n(?!\n)[ \t]*/g, "$1 ");
}

export function clipPassage(passage: string): string {
  const one = plainPassage(passage).replace(/\s+/g, " ").trim();
  return one.length > 60 ? `${one.slice(0, 57)}…` : one;
}

/** "Replace “x” with “y”", "Delete “x”" or "Insert “y”", for a suggestion. */
export function describeSuggestion(root: CommentRecord): string {
  const clip = (s: string) => `“${clipPassage(s)}”`;
  const exact = root.target?.quote.exact ?? "";
  const replacement = root.suggestion?.replacement ?? "";
  if (exact && replacement) return `Replace ${clip(exact)} with ${clip(replacement)}`;
  if (exact) return `Delete ${clip(exact)}`;
  return `Insert ${clip(replacement)}`;
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

/** "5 minutes ago", "yesterday", or a date for anything older than a week. */
export function when(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.round((then - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return relative.format(0, "second");
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
