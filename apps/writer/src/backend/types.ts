// What the writer needs from a collection. Two implementations: Connect (real
// collections) and a demo on the SDK's in-memory record authority.
import type { JsonObject, MdbaseRecords } from "@mdbase-dev/connect";
import type { CslItem, StyleId, TemplateName } from "@mdbase-writer/core";

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const fail = <T>(message: string): Result<T> => ({ ok: false, message });

export interface ManuscriptSummary {
  readonly path: string;
  readonly title: string;
  readonly template?: string;
  readonly style?: string;
}

/** A Reader source that can be cited. */
export interface LibraryEntry {
  readonly key: string;
  readonly item: CslItem;
  readonly title: string;
  readonly path: string;
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
  index(): Promise<Result<CollectionIndex>>;
  library(): Promise<Result<LibraryEntry[]>>;
  readFile(path: string): Promise<Result<Uint8Array>>;
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
