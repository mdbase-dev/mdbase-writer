// Finding sources by what a writer remembers: author, words of the title,
// year, or the citekey itself.
import type { LibraryEntry } from "../backend/types.js";

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Indexed {
  readonly entry: LibraryEntry;
  readonly key: string;
  readonly haystack: string;
}

const indexes = new WeakMap<readonly LibraryEntry[], Indexed[]>();

function index(library: readonly LibraryEntry[]): Indexed[] {
  let found = indexes.get(library);
  if (!found) {
    found = library.map((entry) => {
      const names = (["author", "editor", "translator"] as const).flatMap((role) => {
        const list = entry.item[role];
        return Array.isArray(list) ? list.map((n: { family?: string; given?: string; literal?: string }) => [n.family, n.given, n.literal].filter(Boolean).join(" ")) : [];
      });
      const container = typeof entry.item["container-title"] === "string" ? entry.item["container-title"] : "";
      return { entry, key: fold(entry.key), haystack: fold([entry.key, ...names, entry.title, container, yearOf(entry) ?? ""].join(" ")) };
    });
    indexes.set(library, found);
  }
  return found;
}

export function yearOf(entry: LibraryEntry): string | undefined {
  const issued = entry.item["issued"] as { "date-parts"?: (number | string)[][]; literal?: string; raw?: string } | undefined;
  const year = issued?.["date-parts"]?.[0]?.[0] ?? /\d{4}/.exec(issued?.literal ?? issued?.raw ?? "")?.[0];
  return year === undefined ? undefined : String(year);
}

/** The title up to its subtitle, shortened to about `max` characters: "Charles Darwin". */
export function shortTitle(title: string, max = 40): string {
  const main = title.split(/[:.?!]\s/)[0]?.trim() ?? title;
  if (main.length <= max) return main;
  const cut = main.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max / 2)).replace(/[\s,;]+$/, "")}…`;
}

/** "Darwin, 1881" or "Darwin et al., 1881". */
export function authorYear(entry: LibraryEntry): string {
  const author = (entry.item["author"] ?? entry.item["editor"]) as { family?: string; literal?: string }[] | undefined;
  const first = author?.[0];
  const name = first?.family ?? first?.literal ?? "";
  return [name + (author && author.length > 1 ? " et al." : ""), yearOf(entry)].filter(Boolean).join(", ");
}

/**
 * Sources matching every word of the query (in the key, names, title,
 * container or year), citekey prefixes first. "darwin 1881", "selborne",
 * "darwinFo" all work. Among equally good matches, `preferred` keys (the
 * sources a manuscript already cites) come first.
 */
export function searchLibrary(library: readonly LibraryEntry[], query: string, limit = 50, preferred?: { has(key: string): boolean }): LibraryEntry[] {
  const prefer = (e: LibraryEntry) => (preferred?.has(e.key) ? 1 : 0);
  // A citekey-shaped query also splits where letters meet digits ("darwin81").
  const words = fold(query)
    .split(/[\s,;]+|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u)
    .filter(Boolean);
  const q = fold(query.trim());
  if (!words.length) return (preferred ? [...library].sort((a, b) => prefer(b) - prefer(a)) : library).slice(0, limit);
  const scored: { entry: LibraryEntry; score: number }[] = [];
  for (const i of index(library)) {
    const score = i.key.startsWith(q) ? 3 : i.key.includes(q) ? 2 : words.every((w) => i.haystack.includes(w)) ? 1 : 0;
    if (score) scored.push({ entry: i.entry, score });
  }
  scored.sort((a, b) => b.score - a.score || prefer(b.entry) - prefer(a.entry) || authorYear(a.entry).localeCompare(authorYear(b.entry)));
  return scored.slice(0, limit).map((s) => s.entry);
}
