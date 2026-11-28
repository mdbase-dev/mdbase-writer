// @vitest-environment jsdom
import { performance } from "node:perf_hooks";
import { expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { render } from "../../src/test/render.js";
import { OutlinePanel } from "../../src/ui/OutlinePanel.js";
import { ManuscriptStats } from "../../src/ui/stats.js";
import { searchManuscript } from "../../src/ui/search.js";
import type { RecordView } from "../../src/workspace/workspace.js";

it("updates the open outline across a 120-chapter manuscript", () => {
  const main = "main.md";
  const chapters = Array.from({ length: 120 }, (_, i) => `chapters/chapter-${i}.md`);
  const order = [main, ...chapters];
  const chapterBody = Array.from({ length: 24 }, (_, i) => `## Section ${i}\n\n${"Evidence from the collection supports this passage [@source]. ".repeat(12)}\n\n`).join("");
  const view = (path: string, body: string): RecordView => {
    const frontmatter = { title: path };
    return {
      path,
      snapshot: {
        body, frontmatter, state: "saved", dirty: false,
        remote: null, problem: null, recovery: null, lastReceipt: null,
        record: { id: path, path, body, frontmatter, revision: "fixture", types: [], state: { state: "confirmed", confirmedSeq: 1 } },
      },
    };
  };
  const mainView = view(main, chapters.map(path => `![[${path}]]\n`).join(""));
  const records = new Map([[main, mainView], ...chapters.map(path => [path, view(path, chapterBody)] as const)]);
  const commentOffsets = new Map(chapters.map(path => [path, [100, 900, 1700]]));
  const props = { main, order, chapters, words: 350_000, byRecord: new Map(), commentOffsets, onOpen: vi.fn(), onJump: vi.fn(), onMove: vi.fn(), onAdd: vi.fn() };
  const edited = chapters[0]!;
  const panel = (active: string, current = records, offset = 0) => <OutlinePanel {...props} records={current} active={active} cursor={{ record: active, offset }} />;
  const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value() {} });
  try {
    const library = Array.from({ length: 5000 }, (_, i) => {
      const key = i ? `source${i}` : "source";
      return { key, path: `sources/${key}.md`, title: key, item: { id: key, type: "book" } };
    });
    const start = performance.now();
    const stats = new ManuscriptStats().derive(order, records, library);
    props.words = stats.words;
    const rendered = render(panel(edited));
    const initialMs = performance.now() - start;
    expect(stats.words).toBeGreaterThan(240_000);
    expect(stats.cited.get("source")).toBe(34_560);
    expect(rendered.container.querySelector(".outline-manuscript .record-words")?.textContent).toContain(stats.words.toLocaleString("en"));
    console.log(`Initial stats and mounted outline: ${initialMs.toFixed(2)} ms`);
    try {
      fireEvent.click(rendered.getByRole("button", { name: /Show 50 more chapters/ }));
      fireEvent.click(rendered.getByRole("button", { name: /Show 50 more chapters/ }));
      expect(rendered.container.querySelectorAll(".record-row")).toHaveLength(chapters.length);
      const measure = (label: string, operation: (i: number) => void) => {
        const samples: number[] = [];
        for (let i = 0; i < 25; i++) {
          const start = performance.now();
          operation(i);
          if (i >= 5) samples.push(performance.now() - start);
        }
        samples.sort((a, b) => a - b);
        console.log(`${label}: p50 ${samples[10]!.toFixed(2)} ms, p95 ${samples[18]!.toFixed(2)} ms (${samples.length} samples)`);
      };
      measure("Typing in one chapter", i => {
        const next = new Map(records).set(edited, view(edited, chapterBody.replace("Evidence", `New word ${i} Evidence`)));
        rendered.rerender(panel(edited, next, 20 + i));
      });
      expect(rendered.container.querySelector(".heading-words")?.textContent).toBe("87");
      const revisit = [chapters[4]!, chapters[18]!, chapters[39]!, chapters[57]!];
      measure("Switching chapters", i => rendered.rerender(panel(revisit[i % revisit.length]!)));
      const bodyOf = (path: string) => records.get(path)?.snapshot.body;
      const results = searchManuscript("Chapter-119", order, bodyOf);
      expect(results.total).toBe(1);
      expect(searchManuscript("Evidence", order, bodyOf)).toMatchObject({ total: 34_560, truncated: true });
      measure("Sparse manuscript search", () => searchManuscript("Chapter-119", order, bodyOf));
      measure("Broad manuscript search", () => searchManuscript("Evidence", order, bodyOf));
      expect(rendered.container.querySelector('[aria-current="true"]')?.getAttribute("data-path")).toBe(revisit[0]);
      expect(rendered.container.querySelectorAll(".heading-row")).toHaveLength(24);
    } finally { rendered.unmount(); }
  } finally {
    if (scroll) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scroll);
    else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});
