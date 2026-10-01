// Comments as the mdbase.comment contract defines them: records of their own,
// anchored to a quote of the commented record's Markdown body. Nothing here
// depends on the writer; it is the part other apps will want to share.
//
// Offsets in a stored text_position are Unicode code points of the body;
// everything else here (and CodeMirror) uses UTF-16 offsets.

import { PathIndex, resolveLinkTarget } from "./records.js";

export interface CommentQuote {
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

export interface CommentTextPosition {
  readonly basis: { readonly profile: "markdown-body"; readonly hash: string };
  readonly unit: "unicode_code_point";
  readonly start: number;
  readonly end: number;
}

export interface CommentTarget {
  readonly quote: CommentQuote;
  readonly text_position?: CommentTextPosition;
}

export type CommentMotivation = "commenting" | "replying" | "editing";

/** One comment record, through the contract's field names. */
export interface CommentRecord {
  readonly path: string;
  /** The link to the commented record, as stored (`[[chapters/method]]`). */
  readonly document: string;
  readonly inReplyTo?: string;
  readonly motivation: CommentMotivation;
  readonly target?: CommentTarget;
  readonly suggestion?: { readonly replacement: string; readonly outcome?: "accepted" | "rejected" };
  readonly status: "open" | "resolved";
  readonly resolvedBy?: string;
  readonly resolvedAt?: string;
  readonly createdBy?: string;
  readonly createdAt: string;
  readonly deletedAt?: string;
  /** The comment's text (its Markdown body). */
  readonly text: string;
}

export interface CommentThread {
  readonly root: CommentRecord;
  /** Replies, oldest first. */
  readonly replies: readonly CommentRecord[];
}

/** How much text either side of a quote is kept to tell repeated occurrences apart. */
export const QUOTE_CONTEXT = 32;

const string = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v : undefined);
const object = (v: unknown): Record<string, unknown> | undefined =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;

function parseTarget(value: unknown): CommentTarget | undefined {
  const quote = object(object(value)?.["quote"]);
  const exact = string(quote?.["exact"]);
  if (!quote || exact === undefined) return undefined;
  const prefix = string(quote["prefix"]);
  const suffix = string(quote["suffix"]);
  if (!exact && !prefix && !suffix) return undefined;
  const position = object(object(value)?.["text_position"]);
  const basis = object(position?.["basis"]);
  const start = position?.["start"];
  const end = position?.["end"];
  const hash = string(basis?.["hash"]);
  const text_position: CommentTextPosition | undefined =
    basis?.["profile"] === "markdown-body" && hash && position?.["unit"] === "unicode_code_point" && Number.isInteger(start) && Number.isInteger(end)
      ? { basis: { profile: "markdown-body", hash }, unit: "unicode_code_point", start: start as number, end: end as number }
      : undefined;
  return { quote: { exact, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) }, ...(text_position ? { text_position } : {}) };
}

/**
 * A comment from a record's contract projection (frontmatter under the
 * contract's field names) and body; null when it is not a usable comment.
 */
export function commentFromRecord(path: string, fields: Readonly<Record<string, unknown>> | undefined, body: string): CommentRecord | null {
  const document = nonEmpty(fields?.["document"]);
  const createdAt = nonEmpty(fields?.["created_at"]);
  if (!fields || !document || !createdAt) return null;
  const motivation = fields["motivation"] === "replying" || fields["motivation"] === "editing" ? fields["motivation"] : "commenting";
  const target = parseTarget(fields["target"]);
  const rawSuggestion = object(fields["suggestion"]);
  const replacement = string(rawSuggestion?.["replacement"]);
  const outcome = rawSuggestion?.["outcome"] === "accepted" || rawSuggestion?.["outcome"] === "rejected" ? rawSuggestion["outcome"] : undefined;
  const optional = (key: string, field: string) => {
    const v = nonEmpty(fields[field]);
    return v ? { [key]: v } : {};
  };
  return {
    path,
    document,
    motivation,
    status: fields["status"] === "resolved" ? "resolved" : "open",
    createdAt,
    text: body.trim(),
    ...(target ? { target } : {}),
    ...(replacement !== undefined ? { suggestion: { replacement, ...(outcome ? { outcome } : {}) } } : {}),
    ...optional("inReplyTo", "in_reply_to"),
    ...optional("resolvedBy", "resolved_by"),
    ...optional("resolvedAt", "resolved_at"),
    ...optional("createdBy", "created_by"),
    ...optional("deletedAt", "deleted_at"),
  };
}

/** The path part of a link (`[[chapters/method|Method]]` → `chapters/method`), or the value as it is. */
export function linkPath(link: string): string {
  const inner = /^\s*\[\[([^\]]*)\]\]\s*$/.exec(link)?.[1] ?? link;
  return (inner.split("|")[0] ?? "").split("#")[0]?.trim() ?? "";
}

/** The link a comment stores for a record path: `[[chapters/method]]`. */
export const recordLink = (path: string) => `[[${path.replace(/\.md$/i, "")}]]`;

/**
 * Comments grouped into threads, oldest thread first. A reply whose first
 * comment is missing (deleted by hand, not yet synced) becomes a thread of its own.
 */
export function commentThreads(comments: readonly CommentRecord[]): CommentThread[] {
  const byPath = new Map(comments.map((c) => [c.path.replace(/\.md$/i, "").toLowerCase(), c]));
  const paths = new PathIndex(comments.map((c) => c.path));
  const rootOf = (c: CommentRecord) => {
    if (!c.inReplyTo) return undefined;
    const target = linkPath(c.inReplyTo);
    const resolved = resolveLinkTarget(target, c.path, paths);
    return byPath.get(target.replace(/\.md$/i, "").toLowerCase()) ?? (resolved ? byPath.get(resolved.replace(/\.md$/i, "").toLowerCase()) : undefined);
  };
  const replies = new Map<CommentRecord, CommentRecord[]>();
  const roots: CommentRecord[] = [];
  for (const c of comments) {
    const root = rootOf(c);
    if (root && !root.inReplyTo) {
      let thread = replies.get(root);
      if (!thread) { thread = []; replies.set(root, thread); }
      thread.push(c);
    } else roots.push(c);
  }
  const byTime = (a: CommentRecord, b: CommentRecord) => a.createdAt.localeCompare(b.createdAt) || a.path.localeCompare(b.path);
  return roots.sort(byTime).map((root) => ({ root, replies: (replies.get(root) ?? []).sort(byTime) }));
}

/** Code points in `text` before UTF-16 offset `offset`. */
export function codePointOffset(text: string, offset: number): number {
  let points = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < offset) i++;
    points++;
  }
  return points;
}

/** The UTF-16 offset of code point `points` in `text` (the end when past it). */
export function utf16Offset(text: string, points: number): number {
  let i = 0;
  for (let p = 0; p < points && i < text.length; p++) {
    const c = text.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < text.length ? 2 : 1;
  }
  return i;
}

/** `sha256:` and the hex SHA-256 of the body's UTF-8 bytes (the text_position basis). */
export async function bodyHash(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return `sha256:${[...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** The target for the text between UTF-16 offsets `from` and `to` of `body`. */
export function targetFor(body: string, from: number, to: number, hash: string): CommentTarget {
  const exact = body.slice(from, to);
  const prefix = body.slice(Math.max(0, from - QUOTE_CONTEXT), from);
  const suffix = body.slice(to, to + QUOTE_CONTEXT);
  return {
    quote: { exact, ...(prefix ? { prefix } : {}), ...(suffix ? { suffix } : {}) },
    text_position: {
      basis: { profile: "markdown-body", hash },
      unit: "unicode_code_point",
      start: codePointOffset(body, from),
      end: codePointOffset(body, to),
    },
  };
}

export interface Located {
  readonly from: number;
  readonly to: number;
}

/** Characters of `a` and `b` that agree, counting back from their ends. */
function sharedEnd(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function sharedStart(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/**
 * Where a target's quote is in `body` (UTF-16 offsets), or null when it is
 * detached. The recorded position is used when the quote is still there;
 * otherwise the occurrence whose surroundings best match the recorded prefix
 * and suffix wins, then the one nearest the recorded position.
 */
export function locate(body: string, target: CommentTarget): Located | null {
  const { exact, prefix = "", suffix = "" } = target.quote;
  const hint = target.text_position ? utf16Offset(body, target.text_position.start) : undefined;
  const context = (at: number, end: number) =>
    sharedEnd(body.slice(Math.max(0, at - prefix.length), at), prefix) + sharedStart(body.slice(end, end + suffix.length), suffix);
  if (hint !== undefined && body.slice(hint, hint + exact.length) === exact) {
    // An insertion point carries no text of its own: its context must still agree.
    if (exact || context(hint, hint) === prefix.length + suffix.length) return { from: hint, to: hint + exact.length };
  }
  // An insertion point is found by the text either side of it.
  const needle = exact || prefix + suffix;
  const shift = exact ? 0 : prefix.length;
  if (!needle) return null;
  let best: { at: number; score: number; distance: number } | null = null;
  for (let i = body.indexOf(needle); i >= 0; i = body.indexOf(needle, i + 1)) {
    const at = i + shift;
    const score = exact ? context(at, at + exact.length) : needle.length;
    const distance = hint === undefined ? 0 : Math.abs(at - hint);
    if (!best || score > best.score || (score === best.score && distance < best.distance)) best = { at, score, distance };
  }
  return best ? { from: best.at, to: best.at + exact.length } : null;
}

/** The body with a suggestion applied, or null when its quote cannot be found exactly. */
export function applySuggestion(body: string, target: CommentTarget, replacement: string): string | null {
  const at = locate(body, target);
  if (!at || body.slice(at.from, at.to) !== target.quote.exact) return null;
  return body.slice(0, at.from) + replacement + body.slice(at.to);
}
