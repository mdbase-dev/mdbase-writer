// Deterministic Node proxy for the source picker and preview bibliography.
import { readFileSync } from "node:fs";
import { cpus } from "node:os";
import { Citeproc, type CslItem } from "@mdbase-writer/core/citeproc";
import { expect, it } from "vitest";
import type { LibraryEntry } from "../../src/backend/types.js";
import { searchLibrary } from "../../src/editor/library-search.js";
import { counts, generateCollection } from "./generator.js";

const asset = (name: string) => readFileSync(new URL(`../../../../packages/core/assets/csl/${name}`, import.meta.url), "utf8");
const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
const measure = <T>(run: () => T) => {
  const start = performance.now();
  const result = run();
  return { ms: performance.now() - start, result };
};

it("profiles 5,000 sources with 100 cited entries", () => {
  const library: LibraryEntry[] = [];
  generateCollection((path, type, fields) => {
    if (type !== "reader-source") return;
    const item = fields["csl"] as CslItem;
    library.push({ path, key: item.id, title: String(item["title"]), item });
  });
  expect(library).toHaveLength(counts.sources);
  const items = new Map(library.map(entry => [entry.key, entry.item]));
  const cited = new Set(library.slice(0, 100).map(entry => entry.key));
  const requests = [...cited].map(key => ({ items: [{ key, prefix: "", suffix: "", suppressAuthor: false }], noteIndex: 0 }));
  const locales = new Map(["en-US", "en-GB"].map(locale => [locale, asset(`locales-${locale}.xml`)]));
  const style = asset("apa.csl");
  const samples = [];
  for (let run = 0; run < 9; run++) {
    const sources = [...library];
    const cold = measure(() => searchLibrary(sources, "research", 60, cited));
    expect(cold.result.at(0)?.key).toBe("source00000");
    expect(cold.result).toHaveLength(60);
    const broad = measure(() => {
      for (let i = 0; i < 100; i++) searchLibrary(sources, "research", 60, cited);
    });
    const exact = measure(() => {
      for (let i = 0; i < 100; i++) searchLibrary(sources, "source04999", 60, cited);
    });
    expect(searchLibrary(sources, "source04999", 60, cited).at(0)?.key).toBe("source04999");
    const fresh = measure(() => {
      const engine = new Citeproc(style, locales, items);
      return { engine, formatted: engine.process(requests) };
    });
    const { engine, formatted } = fresh.result;
    expect(formatted.bibliography.entries).toHaveLength(cited.size);
    expect(new Set(formatted.bibliography.entries.map(entry => entry.key))).toEqual(cited);
    const warm = measure(() => engine.process(requests));
    expect(warm.result.mode).toBe("cached");
    expect(warm.result.bibliography).toBe(formatted.bibliography);
    if (run > 1) samples.push({ cold: cold.ms, broad: broad.ms / 100, exact: exact.ms / 100, bibliography: fresh.ms, cached: warm.ms });
  }
  console.log(JSON.stringify({
    node: process.version, cpu: cpus()[0]?.model, samples,
    medians: {
      coldSearchMs: median(samples.map(row => row.cold)),
      broadSearchMs: median(samples.map(row => row.broad)),
      exactSearchMs: median(samples.map(row => row.exact)),
      bibliographyMs: median(samples.map(row => row.bibliography)),
      cachedBibliographyMs: median(samples.map(row => row.cached)),
    },
  }));
});
