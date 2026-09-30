// Which of the collection's comment threads belong to this manuscript, and
// where each is in its record's current text.
import { commentThreads, linkPath, locate, type CommentRecord, type CommentThread, type Located } from "@mdbase-writer/core/comments";
import { resolveLinkTarget } from "@mdbase-writer/core/records";

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
export function placeThreads(
  comments: readonly CommentRecord[],
  order: readonly string[],
  bodies: (path: string) => string | undefined,
  recordPaths: readonly string[],
): PlacedThread[] {
  const candidates = new Set(recordPaths);
  const rank = new Map(order.map((p, i) => [p, i]));
  const placed: PlacedThread[] = [];
  for (const thread of commentThreads(comments)) {
    if (!shown(thread)) continue;
    const record = resolveLinkTarget(linkPath(thread.root.document), thread.root.path, candidates);
    const body = record === null ? undefined : bodies(record);
    if (record === null || !rank.has(record) || body === undefined) continue;
    placed.push({ thread, record, at: thread.root.target ? locate(body, thread.root.target) : "whole" });
  }
  const position = (p: PlacedThread) => (p.at === "whole" ? -1 : p.at === null ? Number.MAX_SAFE_INTEGER : p.at.from);
  return placed.sort((a, b) => (rank.get(a.record) ?? 0) - (rank.get(b.record) ?? 0) || position(a) - position(b));
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
export function clipPassage(passage: string): string {
  const one = passage.replace(/\s+/g, " ").trim();
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
