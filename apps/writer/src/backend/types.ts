// Writer's JSON display/draft values; native witnesses remain owned by the SDK.
export type JsonValue = null | boolean | number | string | JsonValue[] | JsonObject;
export interface JsonObject { [key: string]: JsonValue | undefined }
import type { CslItem, StyleId, TemplateName } from "@mdbase-writer/core";
import type { SourceAnnotation } from "@mdbase-writer/core/annotations";
import type { CommentRecord } from "@mdbase-writer/core/comments";

import { chapterEmbeds } from "../workspace/chapters.js";
import { embedCount, wordCount } from "../words.js";
import type { CommentChange, NewComment, People } from "./comments.js";

export { sourceAnnotation, type SourceAnnotation } from "@mdbase-writer/core/annotations";

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
  /** Those embeds' targets as written, for counting a book's words. */
  readonly chapters?: readonly string[];
}

/** What the manuscript list shows of a record's body. */
export function bodySummary(body: string | undefined): Pick<ManuscriptSummary, "words" | "embeds" | "chapters"> {
  return body === undefined ? {} : { words: wordCount(body), embeds: embedCount(body), chapters: chapterEmbeds(body).map((e) => e.target) };
}

/** A Reader source that can be cited. */
export interface LibraryEntry {
  readonly key: string;
  readonly item: CslItem;
  readonly title: string;
  readonly path: string;
  /** When the source record was last written (ISO 8601), when the collection says. */
  readonly modified?: string;
}

export interface CollectionIndex {
  /** Every Markdown record path (for resolving embeds). */
  readonly recordPaths: readonly string[];
  /** Every other file path (for resolving images). */
  readonly filePaths: readonly string[];
  /**
   * The Markdown records that are someone's writing, which could become a
   * manuscript: not comments, people, or Reader's sources and annotations.
   */
  readonly notePaths: readonly string[];
  /** Records with no type at all: shown as notes with a calm "No type" label. */
  readonly untypedPaths?: readonly string[];
  /** Writer's types that can't be used because their definition has an error. */
  readonly unavailableTypes?: readonly UnavailableType[];
}
export interface UnavailableType {
  readonly name: string;
  /** Plain copy naming the type and what is unavailable; the rest still works. */
  readonly message: string;
}

export interface CollectionDelta {
  readonly paths: readonly string[];
  readonly index?: CollectionIndex;
  readonly library?: LibraryEntry[];
  readonly manuscripts?: ManuscriptSummary[];
  readonly annotations?: boolean;
  readonly comments?: boolean;
  readonly reset?: boolean;
  readonly problem?: string;
}

export interface ManuscriptBinding {
  readonly name: string;
  readonly fields: Readonly<Record<string, string>>;
}

export interface NewManuscript {
  readonly title: string;
  readonly template: TemplateName;
  readonly style: StyleId;
  /** An optional worked example, without invented library sources. */
  readonly starter?: boolean;
  /** A stable name for this one creation, reused by its retries so it lands once. */
  readonly intent?: string;
}

// This is the workspace's application port, not a concrete SDK class. The
// SDK adapter keeps
// receipt confirmation, drafts, conflict and exact-recovery behavior intact.
export type RecordSessionState = "saved" | "saved_on_device" | "unsaved" | "saving" | "conflict" | "recovery" | "error" | "deleted";

export interface SessionProblem {
  readonly code: string;
  readonly message?: string;
}

export interface SessionRecord {
  readonly path: string;
  readonly revision: string;
  readonly types: readonly string[];
  readonly frontmatter: JsonObject;
  readonly body?: string;
}

export interface RecordSessionSnapshot {
  readonly state: RecordSessionState;
  readonly body: string;
  readonly frontmatter: JsonObject;
  readonly record: SessionRecord;
  readonly remote: SessionRecord | null;
  readonly dirty: boolean;
  readonly problem: SessionProblem | null;
}

export type RecordResolution = { readonly keep: "mine" | "theirs" } | { readonly body: string };

export interface RecordSession {
  getSnapshot(): RecordSessionSnapshot;
  subscribe(listener: () => void): () => void;
  setBody(body: string): void;
  patchFrontmatter(patch: JsonObject): void;
  resolve(choice: RecordResolution): void;
  /** Flush until acknowledged, or preserve the draft with an actionable problem. */
  flush(options?: { timeoutMs?: number }): Promise<{ readonly ok: true } | { readonly ok: false; readonly problem: SessionProblem }>;
}

export interface RecordLease {
  readonly session: RecordSession;
  release(): void;
}

export interface RecordOpenOptions {
  readonly autosave?: { readonly idleMs: number } | false;
  readonly timeoutMs?: number;
}

export interface WriterRecords {
  open(path: string, options?: RecordOpenOptions): Promise<{ readonly ok: true; readonly value: RecordLease } | { readonly ok: false; readonly problem: SessionProblem }>;
}

export interface WriterBackend {
  readonly setupStatus?: { readonly sources: boolean; readonly annotations: boolean; readonly comments: boolean } | undefined;
  readonly kind: "connect" | "demo";
  readonly collectionName: string;
  /** Stable, non-secret collection identity for local draft isolation. */
  readonly draftNamespace?: string;
  manuscriptBindings?(): Promise<Result<readonly ManuscriptBinding[]>>;
  readonly records: WriterRecords;
  listManuscripts(): Promise<Result<ManuscriptSummary[]>>;
  createManuscript(input: NewManuscript): Promise<Result<string>>;
  /** Marks an existing note as a manuscript (adds the manuscript type; keeps its other types). */
  adoptManuscript(path: string): Promise<Result<string>>;
  /** Creates a plain Markdown record at `path`, or at `path` numbered when that is taken; resolves to its path.
   * `intent` names this one creation; a retry with the same `intent` lands once. */
  createRecord(path: string, body: string, intent?: string): Promise<Result<string>>;
  index(): Promise<Result<CollectionIndex>>;
  library(): Promise<Result<LibraryEntry[]>>;
  /** Annotation identity discovery, without reading any bodies. */
  annotationPaths(): Promise<Result<readonly string[]>>;
  /** Discovered mappings for embedded annotation sessions (whose bodies stay lazy). */
  annotationFields?(path: string, types?: readonly string[]): Readonly<Record<string, string>>;
  /** Only this source's Reader annotations (including relative and bare source links). */
  annotationsForSource(path: string): Promise<Result<SourceAnnotation[]>>;
  readFile(path: string): Promise<Result<Uint8Array>>;
  /** Stores a file (an image for a figure) at `path`, or at `path` numbered when that is taken; resolves to its path. */
  writeFile?(path: string, bytes: Uint8Array, mediaType?: string): Promise<Result<string>>;
  /** A Markdown record's body, read once (no record session). */
  readBody(path: string): Promise<Result<string>>;
  /** Metadata selects threads for these manuscript records; only their bodies are read. No scope means all. */
  comments(scope?: readonly string[]): Promise<Result<CommentRecord[]>>;
  /** Writes a new comment, reply or suggestion, signed by the signed-in account's person record when it has one. */
  createComment(input: NewComment): Promise<Result<CommentRecord>>;
  changeComment(comment: CommentRecord, change: CommentChange): Promise<Result<CommentRecord>>;
  /** Person records' names, and the signed-in account's own record (loaded once, unless `fresh`). */
  people(options?: { fresh?: boolean }): Promise<People>;
  /** Asks Connect to approve Writer again, so the account can allow its identity to be seen. */
  reviewIdentityAccess?(): Promise<Result<void>>;
  /** Changed paths; an empty list requests reconciliation after a watch gap or schema change. */
  onExternalChange(listener: (paths: readonly string[]) => void): () => void;
  /** Applied, coalesced collection changes (after the shared caches are updated). */
  onCollectionChange?(listener: (delta: CollectionDelta) => void): () => void;
  /** Await queued path reads, e.g. before navigation or export. */
  flushChanges?(): Promise<Result<void>>;
  /** Explicit full reconciliation; ordinary changes never call this. */
  reconcile?(): Promise<Result<void>>;
  dispose(): void;
}

export function manuscriptFrontmatter(frontmatter: JsonObject, fields: Readonly<Record<string, string>>): JsonObject {
  const out = { ...frontmatter };
  for (const [canonical, local] of Object.entries(fields)) {
    // A mapped field is authoritative, including when it has not been set yet.
    delete out[canonical];
    if (local in frontmatter) out[canonical] = frontmatter[local] as JsonObject[string];
  }
  return out;
}

export const manuscriptBody = (starter = false, citekey?: string): string => starter
  ? `# Introduction {#sec-intro}\n\nStart writing here. This manuscript stays ordinary Markdown in your collection.\n\n${citekey ? `A cited claim [@${citekey}, p. 12].` : "Add a source in Reader, then type [@ to find it by author or title."}\n\n## A labelled figure\n\nReplace the path below with an image in your collection. Until then, Writer will report a missing image.\n\n![An example figure](figures/example.png){#fig-example}\n\nRefer to it with @fig-example, and to this section with @sec-intro.\n\n## Chapters\n\nUse **Add chapter** in the Outline to create and embed a chapter. Existing records can be embedded on a line of their own with \`![[chapters/one]]\`.\n\n## Finishing\n\nUse Settings to choose a layout and citation style. Export PDF, Word, or a Pandoc bundle.\n`
  : "# Introduction {#sec-intro}\n\n";

/** The citekey of a CSL-JSON item in a Reader source's `csl` field. */
export function libraryEntry(path: string, frontmatter: JsonObject | undefined, modified?: string): LibraryEntry | null {
  const csl = frontmatter?.["csl"];
  if (!csl || typeof csl !== "object" || Array.isArray(csl)) return null;
  const item = csl as Record<string, unknown>;
  const key = typeof item["id"] === "string" ? item["id"] : null;
  if (!key) return null;
  const title = typeof item["title"] === "string" ? item["title"] : typeof frontmatter?.["title"] === "string" ? frontmatter["title"] : key;
  return { key, item: { ...item, id: key }, title, path, ...(modified ? { modified } : {}) };
}

/** `chapters/x.md` numbered for the nth try: `chapters/x-2.md` (and `figures/x.png` to `figures/x-2.png`). */
export const numberedPath = (path: string, n: number) => (n > 1 ? path.replace(/(\.[a-z0-9]{1,5})?$/i, `-${n}$1`) : path);

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
export function withType(existing: unknown, typeName: string, knownTypes: readonly string[] = []): string | string[] {
  const values = existing === undefined ? [] : Array.isArray(existing) ? [...existing] : [existing];
  if (!values.every((value): value is string => typeof value === "string" && value.length > 0)) {
    throw new Error("Writer cannot add a manuscript type over an invalid explicit type value.");
  }
  const list: string[] = values;
  // Match-rule types also belong to the note. Making membership explicit must
  // not erase them when the collection gives explicit keys precedence.
  for (const type of [...knownTypes, typeName]) {
    if (!list.some(value => value.toLowerCase() === type.toLowerCase())) list.push(type);
  }
  return list.length === 1 && !Array.isArray(existing) ? list[0]! : list;
}

/** A title for a note that has none: its first heading, else its file name. */
export function titleFromNote(path: string, body: string): string {
  const heading = /^#{1,6}\s+(.+?)(?:\s*\{[^}]*\})?\s*$/m.exec(body)?.[1];
  return (heading ?? path.split("/").pop()?.replace(/\.md$/i, "") ?? path).trim();
}
