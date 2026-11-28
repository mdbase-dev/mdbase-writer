// Finding sources by what a writer remembers: author, words of the title,
// year, or the citekey itself.
import type { LibraryEntry } from "../backend/types.js";

const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

interface Indexed {
  readonly entry: LibraryEntry;
  readonly key: string;
  readonly haystack: string;
  readonly sortKey: string;
}

const indexes = new WeakMap<readonly LibraryEntry[], Indexed[]>();
const collator = new Intl.Collator();
const nameRoles = ["author", "editor", "translator"] as const;

function index(library: readonly LibraryEntry[]): Indexed[] {
  let found = indexes.get(library);
  if (!found) {
    found = library.map((entry) => {
      const fields = [entry.key];
      for (const role of nameRoles) {
        const list = entry.item[role];
        if (!Array.isArray(list)) continue;
        for (const name of list) fields.push([name.family, name.given, name.literal].filter(Boolean).join(" "));
      }
      const container = typeof entry.item["container-title"] === "string" ? entry.item["container-title"] : "";
      const year = yearOf(entry);
      fields.push(entry.title, container, year ?? "");
      return { entry, sortKey: formatAuthorYear(entry, year), key: fold(entry.key), haystack: fold(fields.join(" ")) };
    });
    // Stable author/year ordering is shared by every query. Equal keys retain
    // their original library order, including the tie at the result limit.
    found.sort((a, b) => collator.compare(a.sortKey, b.sortKey));
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
  return formatAuthorYear(entry, yearOf(entry));
}

function formatAuthorYear(entry: LibraryEntry, year: string | undefined): string {
  const author = (entry.item["author"] ?? entry.item["editor"]) as { family?: string; literal?: string }[] | undefined;
  const first = author?.[0];
  const name = first?.family ?? first?.literal ?? "";
  return [name + (author && author.length > 1 ? " et al." : ""), year].filter(Boolean).join(", ");
}

/**
 * Sources matching every word of the query (in the key, names, title,
 * container or year), citekey prefixes first. "darwin 1881", "selborne",
 * "darwinFo" all work. Among equally good matches, `preferred` keys (the
 * sources a manuscript already cites) come first.
 */
const sorted = new WeakMap<readonly LibraryEntry[], readonly LibraryEntry[]>();
/** The library as it is listed: most recently written first; sources the collection has no date for follow, by author and title. */
export function sortedLibrary(library: readonly LibraryEntry[]): readonly LibraryEntry[] {
  let rows = sorted.get(library);
  if (!rows) {
    rows = [...index(library)]
      .sort((a, b) => (b.entry.modified ?? "").localeCompare(a.entry.modified ?? "") || collator.compare(a.sortKey, b.sortKey) || collator.compare(a.entry.title, b.entry.title))
      .map((i) => i.entry);
    sorted.set(library, rows);
  }
  return rows;
}

export function searchLibrary(library: readonly LibraryEntry[], query: string, limit = 50, preferred?: { has(key: string): boolean }): LibraryEntry[] {
  // A citekey-shaped query also splits where letters meet digits ("darwin81").
  const q = fold(query.trim());
  const words = q
    .split(/[\s,;]+|(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u)
    .filter(Boolean).reverse();
  if (limit <= 0) return [];
  if (!words.length) {
    if (!preferred) return library.slice(0, limit);
    const first: LibraryEntry[] = [], rest: LibraryEntry[] = [];
    for (const entry of library) { const into = preferred.has(entry.key) ? first : rest; if (into.length < limit) into.push(entry); }
    return [...first, ...rest].slice(0, limit);
  }
  // Key matches outrank metadata matches. Collect them first, then stop the
  // broader metadata scan once it has filled the remaining places in rank order.
  const rows = index(library);
  const keyBuckets: LibraryEntry[][] = [[], [], [], []];
  for (const row of rows) {
    const match = row.key.startsWith(q) ? 0 : row.key.includes(q) ? 2 : -1;
    if (match < 0) continue;
    const bucket = keyBuckets[match + (preferred?.has(row.entry.key) ? 0 : 1)]!;
    if (bucket.length < limit) bucket.push(row.entry);
    if (match === 0 && bucket.length === limit && (!preferred || bucket === keyBuckets[0])) return bucket;
  }
  const keys = keyBuckets.flat();
  if (keys.length >= limit) return keys.slice(0, limit);
  const keyMatches = new Set(keys);
  const remaining = limit - keys.length;
  const first: LibraryEntry[] = [], rest: LibraryEntry[] = [];
  const [word, ...otherWords] = words;
  for (const row of rows) {
    if (!row.haystack.includes(word!) || !otherWords.every(value => row.haystack.includes(value)) || keyMatches.has(row.entry)) continue;
    const bucket = preferred?.has(row.entry.key) ? first : rest;
    if (bucket.length < remaining) bucket.push(row.entry);
    if (first.length === remaining || !preferred && rest.length === remaining) break;
  }
  return keys.concat(first, rest).slice(0, limit);
}
