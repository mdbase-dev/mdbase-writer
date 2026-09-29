// What the writer needs from a collection. Two implementations: Connect (real
// collections) and a demo on the SDK's in-memory record authority.
import type { JsonObject, MdbaseRecords } from "@mdbase-dev/connect";
import type { CslItem, StyleId, TemplateName } from "@mdbase-writer/core";
import type { CommentRecord } from "@mdbase-writer/core/comments";

import { embedCount, wordCount } from "../words.js";
import type { CommentChange, NewComment, People } from "./comments.js";

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(message: string): Result<T> => ({ ok: false, message });

export interface ManuscriptSummary {
  readonly path: string;
  readonly title: string;
  readonly template?: string;
  readonly style?: string;
  /** When the manuscript record was last written (ISO 8601), when the collection says. */
  readonly modified?: string;
  /** Words in the manuscript record itself (embedded records are not counted). */
  readonly words?: number;
  /** Records embedded on a line of their own (chapters). */
  readonly embeds?: number;
}

/** What the manuscript list shows of a record's body. */
export function bodySummary(body: string | undefined): Pick<ManuscriptSummary, "words" | "embeds"> {
  return body === undefined ? {} : { words: wordCount(body), embeds: embedCount(body) };
}

/** A Reader source that can be cited. */
export interface LibraryEntry {
  readonly key: string;
  readonly item: CslItem;
  readonly title: string;
  readonly path: string;
}

/** A Reader annotation: a quotation and/or note on a source, with where it is in the source. */
export interface SourceAnnotation {
  readonly path: string;
  /** Collection path of the annotated source record. */
  readonly source: string;
  readonly quote: string | null;
  readonly note: string;
  /** Reader's locator label ("p. 12"), when it has one. */
  readonly locator?: string;
}

export interface CollectionIndex {
  /** Every Markdown record path (for resolving embeds). */
  readonly recordPaths: readonly string[];
  /** Every other file path (for resolving images). */
  readonly filePaths: readonly string[];
}

export interface NewManuscript {
  readonly title: string;
  readonly template: TemplateName;
  readonly style: StyleId;
}

export interface WriterBackend {
  readonly kind: "connect" | "demo";
  readonly collectionName: string;
  readonly records: Pick<MdbaseRecords<JsonObject>, "open">;
  listManuscripts(): Promise<Result<ManuscriptSummary[]>>;
  createManuscript(input: NewManuscript): Promise<Result<string>>;
  /** Marks an existing note as a manuscript (adds the manuscript type; keeps its other types). */
  adoptManuscript(path: string): Promise<Result<string>>;
  /** Creates a plain Markdown record at `path`, or at `path` numbered when that is taken; resolves to its path. */
  createRecord(path: string, body: string): Promise<Result<string>>;
  index(): Promise<Result<CollectionIndex>>;
  library(): Promise<Result<LibraryEntry[]>>;
  /** Reader annotations in the collection (records implementing dev.mdbase.reader.annotation). */
  annotations(): Promise<Result<SourceAnnotation[]>>;
  readFile(path: string): Promise<Result<Uint8Array>>;
  /** Every comment in the collection (records implementing mdbase.comment), withdrawn ones included. */
  comments(): Promise<Result<CommentRecord[]>>;
  /** Writes a new comment, reply or suggestion, signed by the signed-in account's person record when it has one. */
  createComment(input: NewComment): Promise<Result<CommentRecord>>;
  changeComment(comment: CommentRecord, change: CommentChange): Promise<Result<CommentRecord>>;
  /** Person records' names, and the signed-in account's own record (loaded once). */
  people(): Promise<People>;
  /** Paths changed by other applications or views (for refreshing the index and library). */
  onExternalChange(listener: (paths: readonly string[]) => void): () => void;
  dispose(): void;
}

/** The citekey of a CSL-JSON item in a Reader source's `csl` field. */
export function libraryEntry(path: string, frontmatter: JsonObject | undefined): LibraryEntry | null {
  const csl = frontmatter?.["csl"];
  if (!csl || typeof csl !== "object" || Array.isArray(csl)) return null;
  const item = csl as Record<string, unknown>;
  const key = typeof item["id"] === "string" ? item["id"] : null;
  if (!key) return null;
  const title = typeof item["title"] === "string" ? item["title"] : typeof frontmatter?.["title"] === "string" ? frontmatter["title"] : key;
  return { key, item: { ...item, id: key }, title, path };
}

/**
 * A Reader annotation record as the writer uses it. Reader links the source
 * as `[[path|title]]`; the first blockquote of the body is the quotation and
 * the rest is the note (as Reader's annotationBodyText splits it).
 */
export function sourceAnnotation(path: string, frontmatter: JsonObject | undefined, body: string): SourceAnnotation | null {
  const link = typeof frontmatter?.["source"] === "string" ? frontmatter["source"] : "";
  const target = /^\[\[([^\]|#]+)/.exec(link.trim())?.[1]?.trim() ?? link.trim();
  if (!target) return null;
  const source = /\.md$/i.test(target) ? target : `${target}.md`;
  const locator = frontmatter?.["locator"];
  const rawLabel = locator && typeof locator === "object" && !Array.isArray(locator) ? (locator as JsonObject)["label"] : undefined;
  const label = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : undefined;
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^ {0,3}>/.test(l));
  let end = start;
  if (start >= 0) while (end < lines.length && /^ {0,3}>/.test(lines[end] ?? "")) end++;
  const quote = start >= 0 ? lines.slice(start, end).map((l) => l.replace(/^ {0,3}> ?/, "")).join("\n").trim() || null : null;
  const note = (start >= 0 ? [...lines.slice(0, start), ...lines.slice(end)] : lines).join("\n").trim();
  if (!quote && !note) return null;
  return { path, source, quote, note, ...(label ? { locator: label } : {}) };
}

/** `chapters/x.md` numbered for the nth try: `chapters/x-2.md`. */
export const numberedPath = (path: string, n: number) => (n > 1 ? path.replace(/(\.md)?$/i, `-${n}$1`) : path);

export function manuscriptSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug || "untitled";
}

/**
 * The explicit type value after adding `typeName`: a note that already has a
 * type keeps it (mdbase allows a list of types).
 */
export function withType(existing: unknown, typeName: string): string | string[] {
  const list = Array.isArray(existing) ? existing.filter((t): t is string => typeof t === "string") : typeof existing === "string" && existing ? [existing] : [];
  if (list.some((t) => t.toLowerCase() === typeName.toLowerCase())) return list.length === 1 ? (list[0] as string) : list;
  return list.length ? [...list, typeName] : typeName;
}

/** A title for a note that has none: its first heading, else its file name. */
export function titleFromNote(path: string, body: string): string {
  const heading = /^#{1,6}\s+(.+?)(?:\s*\{[^}]*\})?\s*$/m.exec(body)?.[1];
  return (heading ?? path.split("/").pop()?.replace(/\.md$/i, "") ?? path).trim();
}
