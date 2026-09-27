import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { splitFrontmatter, type CslItem, type WriterRecord } from "../src/index.js";

const here = new URL(".", import.meta.url).pathname;
export const fixturesDir = join(here, "fixtures");
const cslDir = join(here, "..", "assets", "csl");

export function loadStyles(): Map<string, string> {
  return new Map(readdirSync(cslDir).filter((f) => f.endsWith(".csl")).map((f) => [f.replace(/\.csl$/, ""), readFileSync(join(cslDir, f), "utf8")]));
}
export const locales = new Map(
  readdirSync(cslDir)
    .filter((f) => /^locales-.*\.xml$/.test(f))
    .map((f) => [f.replace(/^locales-|\.xml$/g, ""), readFileSync(join(cslDir, f), "utf8")] as const)
    .sort(([a], [b]) => (a === "en-US" ? -1 : b === "en-US" ? 1 : a.localeCompare(b))),
);

let library: Map<string, CslItem> | undefined;
export function loadLibrary(): Map<string, CslItem> {
  library ??= new Map((JSON.parse(readFileSync(join(fixturesDir, "library.json"), "utf8")) as CslItem[]).map((i) => [i.id, i]));
  return library;
}

/** Loads a fixture directory as records (Markdown) and file paths (everything else). */
export function loadFixture(name: string): { records: Map<string, WriterRecord>; files: Set<string> } {
  const records = new Map<string, WriterRecord>();
  const files = new Set<string>();
  const walk = (dir: string, prefix: string) => {
    for (const f of readdirSync(dir)) {
      const full = join(dir, f);
      const rel = prefix ? `${prefix}/${f}` : f;
      if (statSync(full).isDirectory()) walk(full, rel);
      else if (f.endsWith(".md")) {
        const { body, frontmatter } = splitFrontmatter(readFileSync(full, "utf8"));
        records.set(rel, { path: rel, body, frontmatter });
      } else files.add(rel);
    }
  };
  walk(join(fixturesDir, name), "");
  return { records, files };
}
