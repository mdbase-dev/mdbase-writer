// Records as the writer sees them: a Markdown body plus frontmatter, and the
// links between them.
import { parse as parseYaml } from "yaml";

export type Frontmatter = Readonly<Record<string, unknown>>;

export interface WriterRecord {
  readonly path: string;
  readonly body: string;
  readonly frontmatter: Frontmatter;
}

/** Splits a Markdown file with optional YAML frontmatter (for fixtures and imports). */
export function splitFrontmatter(text: string): { body: string; frontmatter: Frontmatter; error?: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { body: text, frontmatter: {} };
  const body = text.slice(m[0].length);
  try {
    const parsed: unknown = parseYaml(m[1] ?? "");
    const frontmatter = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Frontmatter) : {};
    return { body, frontmatter };
  } catch (e) {
    return { body, frontmatter: {}, error: e instanceof Error ? e.message : String(e) };
  }
}

export const IMAGE_EXTENSION = /\.(png|jpe?g|gif|svg|webp)$/i;

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** Joins a relative link onto a directory, resolving `.` and `..`. */
export function joinPath(dir: string, rel: string): string {
  const parts = (rel.startsWith("/") ? rel.slice(1) : dir ? `${dir}/${rel}` : rel).split("/");
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

/**
 * Resolves an embed or link target the way Obsidian-style collections expect:
 * exact collection path, then relative to the linking record, then a unique
 * file name anywhere. Returns the collection path or null.
 */
export function resolveLinkTarget(
  target: string,
  fromPath: string,
  candidates: ReadonlySet<string>,
  extension = ".md",
): string | null {
  const clean = decodeURI(target.trim()).replace(/^\.\//, "");
  const withExt = (p: string) => (extension && !p.toLowerCase().endsWith(extension) && !IMAGE_EXTENSION.test(p) ? p + extension : p);
  const tries = [withExt(joinPath("", clean)), withExt(joinPath(dirname(fromPath), clean))];
  for (const t of tries) if (candidates.has(t)) return t;
  if (!clean.includes("/")) {
    const name = withExt(clean).toLowerCase();
    const matches = [...candidates].filter((c) => c.toLowerCase() === name || c.toLowerCase().endsWith(`/${name}`));
    if (matches.length === 1) return matches[0] ?? null;
  }
  return null;
}
