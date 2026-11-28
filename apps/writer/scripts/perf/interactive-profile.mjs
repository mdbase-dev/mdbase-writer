import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const samples = Number(process.env.PROFILE_RUNS ?? 7);
assert.ok(Number.isInteger(samples) && samples > 0);
const chapters = Number(process.env.PROFILE_CHAPTERS ?? 60);
assert.ok(chapters === 60 || chapters === 120);
const sizes = process.env.PROFILE_LARGE_ONLY === "1" ? [true] : [false, true];
const servers = [process.env.BASELINE, process.env.BASE].filter(Boolean);
assert.ok(servers.length);

async function profile(base, large) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, serviceWorkers: "block" });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  const times = {};
  const now = () => page.evaluate(() => performance.now());
  const measure = async (label, action) => {
    const start = await now();
    await action();
    times[label] = await now() - start;
  };
  try {
    const main = large ? "manuscripts/main.md" : "manuscripts/patient-observation.md";
    const chapter = large ? "chapters/chapter-00000.md" : "chapters/reefs.md";
    const other = large ? "chapters/chapter-00012.md" : "chapters/worms.md";
    const key = large ? "source04999" : "darwinStructure42";
    const params = new URLSearchParams({ demo: large ? "large" : "", manuscript: main });
    if (large) { params.set("largeManuscript", String(chapters)); params.set("longChapter", "1"); }
    await page.goto(new URL("?" + params, base).href);
    const expectedChapters = large ? chapters : 2;
    await page.waitForFunction(count => {
      const w = window.writer?.workspace;
      const s = w?.getSnapshot();
      return s && w.readingOrder().length === count + 1
        && s.records.size === Math.min(count + 1, 64)
        && s.recordProblems.size === Math.max(count + 1 - 64, 0)
        && s.library.length === (count > 2 ? 5000 : 9)
        && document.querySelector(".outline-manuscript .record-words")?.textContent.match(/[1-9]/);
    }, expectedChapters, { timeout: 90_000 });
    times.hydration = await now();
    await page.waitForFunction(large => {
      const s = window.writer.workspace.getSnapshot();
      return s.result?.references.length === (large ? 100 : 4) && s.artifactRevision > 0
        && Number(document.querySelector(".preview-pages")?.dataset.renderedRevision) === s.artifactRevision;
    }, large, { timeout: 90_000 });
    times.previewWithBibliography = await now();
    await measure("citedSourcesPanel", async () => {
      await page.getByRole("tab", { name: /Sources/ }).click();
      await page.getByRole("list", { name: "In this manuscript" }).locator(".source-row").first().waitFor();
    });
    const sourceSearch = page.getByRole("searchbox", { name: "Find a source" });
    await measure("sourceFilter", async () => {
      await sourceSearch.fill(key);
      await page.getByRole("list", { name: "Matching sources" }).locator(`[data-key="${key}"]`).waitFor();
    });
    await sourceSearch.fill("");
    await page.getByRole("tab", { name: "Outline", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "Search outline" });
    await measure("outlineSearch", async () => {
      await search.fill(large ? "Evidence in chapter 60, section 8" : "volcanic island");
      await page.locator(".search-hit").waitFor();
    });
    await search.fill("");
    const open = async path => {
      await page.locator(`.record-row[data-path="${path}"]`).click();
      await page.getByRole("textbox", { name: `Markdown for ${path}`, exact: true }).waitFor();
    };
    await measure("switchPair", async () => { await open(other); await open(chapter); });
    const editor = page.getByRole("textbox", { name: `Markdown for ${chapter}`, exact: true });
    await editor.focus();
    await page.keyboard.press("ControlOrMeta+End");
    await measure("autocomplete", async () => {
      await page.keyboard.insertText(" [@" + key.slice(0, -1));
      await page.keyboard.press("Control+Space");
      await page.locator(".cm-tooltip-autocomplete li").first().waitFor();
    });
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+z");
    const original = await page.evaluate(path => window.writer.workspace.getSnapshot().records.get(path).snapshot.body, chapter);
    const phrase = "The archives show that";
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable", { timeDomain: "threadTicks" });
    const cpu = async () => (await cdp.send("Performance.getMetrics")).metrics.find(m => m.name === "TaskDuration").value * 1000;
    const cpuStart = await cpu();
    await measure("editAndCheckpoint", async () => {
      for (const c of phrase) await page.keyboard.insertText(c);
      const draft = await page.evaluate(({ chapter, large }) => {
        const key = "mdbase-writer:draft:" + (large ? "large-demo" : "demo") + ":" + encodeURIComponent(chapter);
        return JSON.parse(localStorage.getItem(key))?.body;
      }, { chapter, large });
      assert.equal(draft, original + phrase);
    });
    times.editCpu = await cpu() - cpuStart;
    await measure("autosave", async () => {
      await page.waitForFunction(({ chapter, expected }) => {
        const snap = window.writer.workspace.getSnapshot().records.get(chapter).snapshot;
        return snap.state === "saved" && snap.record.body === expected;
      }, { chapter, expected: original + phrase });
    });
    assert.deepEqual(errors, []);
    return times;
  } finally { await page.close(); }
}

try {
  for (let run = 1; run <= samples; run++) {
    for (const large of sizes) {
      for (const base of run % 2 ? servers : [...servers].reverse()) {
        console.log(JSON.stringify({ chromium: browser.version(), run, large, chapters: large ? chapters : 2, base, ms: await profile(base, large) }));
      }
    }
  }
} finally { await browser.close(); }
