import { describe, expect, it } from "vitest";
import { matchingPaths } from "./completions.js";
import { authorYear, searchLibrary, sortedLibrary } from "./library-search.js";
import type { LibraryEntry } from "../backend/types.js";
describe("bounded search", () => {
  it("finds a later embed after a broad prefix without truncating the collection", () => {
    const paths = Array.from({ length: 58100 }, (_, i) => `notes/note-${i}.md`);
    expect(matchingPaths(paths, "")).toHaveLength(100);
    expect(matchingPaths(paths, "note-58099")).toEqual(["notes/note-58099"]);
    expect(matchingPaths(["image.png", "Note.MD"], "note")).toEqual(["Note"]);
  });
  it("top-k preserves stable full-sort ranking across broad author/title/key queries", () => {
    const library: LibraryEntry[] = Array.from({ length: 5000 }, (_, i) => ({ key: `key${i}`, title: `Evidence ${i}`, path: `${i}.md`, item: { id: `key${i}`, author: [{ family: `Author${i % 53}` }], issued: { "date-parts": [[2000 + i % 20]] } } }));
    const preferred = new Set(["key4999", "key7", "key13"]);
    for (const query of ["", "key", "evidence", "author", "Author12", "key49"]) {
      const q = query.toLowerCase(), words = q.split(/(?<=\p{L})(?=\p{N})|(?<=\p{N})(?=\p{L})/u).filter(Boolean);
      const score = (e: LibraryEntry) => e.key.startsWith(q) ? 3 : e.key.includes(q) ? 2 : words.every((w) => `${e.key} ${authorYear(e)} ${e.title}`.toLowerCase().includes(w)) ? 1 : 0;
      const expected = library.filter((e) => !q || score(e)).sort((a, b) => (q ? score(b) - score(a) : 0) || Number(preferred.has(b.key)) - Number(preferred.has(a.key)) || (q ? authorYear(a).localeCompare(authorYear(b)) : 0)).slice(0, 60);
      expect(searchLibrary(library, query, 60, preferred)).toEqual(expected);
    }
    expect(sortedLibrary(library)).toBe(sortedLibrary(library));
  });
});
