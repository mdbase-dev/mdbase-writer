import { performance } from "node:perf_hooks";
import { expect, it } from "vitest";
import { materialize, type CslItem, type WriterRecord } from "@mdbase-writer/core";

it("profiles Word Markdown assembly for 120 chapters and 5,000 sources", () => {
  const records = new Map<string, WriterRecord>();
  const library = new Map<string, CslItem>();
  const main = "manuscripts/main.md";
  const filePaths = new Set<string>();
  for (let i = 0; i < 5_000; i++) {
    const id = `source${i}`;
    library.set(id, { id, type: "book", title: `Source ${i}` });
  }
  const chapters = Array.from({ length: 120 }, (_, chapter) => {
    const path = `chapters/chapter-${chapter}.md`;
    const sections = Array.from({ length: 24 }, (_, section) => {
      const id = `${chapter}-${section}`;
      const source = chapter * 24 + section;
      return `### Section ${id} {#sec-${id}}\n\n`
        + `Evidence [@source${source}] supports the account in [@sec-${id}]. Compare @fig-${chapter}.\n\n`
        + `An example remains literal in code: \`@sec-${id}\`.\n`;
    });
    const figure = `figure-${chapter}.png`;
    filePaths.add(`chapters/figures/${figure}`);
    records.set(path, {
      path, frontmatter: {},
      body: `## Chapter ${chapter}\n\n![Evidence from chapter ${chapter}](figures/${figure}){#fig-${chapter}}\n\n`
        + sections.join("\n"),
    });
    return path;
  });
  records.set(main, { path: main, frontmatter: { title: "Large manuscript" }, body: "# Introduction\n\n" + chapters.map(path => `![[${path}]]`).join("\n\n") });
  const input = { main, records, filePaths, recordPaths: new Set(records.keys()), library, styles: new Map<string, string>(), crossReferences: "resolved" as const };
  const samples: number[] = [];
  for (let run = 0; run < 24; run++) {
    const start = performance.now();
    const output = materialize(input);
    const elapsed = performance.now() - start;
    if (run >= 4) samples.push(elapsed);
    expect(output.problems).toEqual([]);
    expect(output.references).toHaveLength(2_880);
    expect(output.media.size).toBe(120);
    expect(output.markdown).toContain("## 1.120 Chapter 119");
    expect(output.markdown).toContain("[Section 1.120.24](#sec-119-23)");
    expect(output.markdown).toContain("[Figure 120](#fig-119)");
    expect(output.markdown).toContain("`@sec-119-23`");
  }
  samples.sort((a, b) => a - b);
  const median = (samples[9]! + samples[10]!) / 2;
  const p95 = samples[Math.ceil(0.95 * samples.length) - 1]!;
  console.log(`Word Markdown assembly: median ${median.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms (${samples.length} samples)`);
});
