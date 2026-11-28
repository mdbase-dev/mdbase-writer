import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";

const fixture = new URL(process.env.BASE ?? "http://127.0.0.1:5320/");
const main = "manuscripts/main.md";
const chapter = "chapters/chapter-00000.md";
fixture.search = new URLSearchParams({ demo: "large", largeManuscript: "1", longChapter: "1", manuscript: main }).toString();
const runs = Number(process.env.PROFILE_RUNS ?? 5);
assert.ok(Number.isInteger(runs) && runs > 0, "PROFILE_RUNS must be a positive integer");
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return (sorted[mid] + sorted[Math.ceil(sorted.length / 2) - 1]) / 2;
};
const browser = await chromium.launch({ executablePath: process.env.CHROME });
console.log(JSON.stringify({ chromium: browser.version(), node: process.version }));
try {
  for (let run = 1; run <= runs; run++) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, serviceWorkers: "block" });
    try {
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("mdbase-writer:layout", JSON.stringify({ view: "write" })));
      await page.goto(fixture.href);
      await page.waitForFunction(() => {
        const workspace = window.writer?.workspace;
        if (!workspace) return false;
        const snap = workspace.getSnapshot();
        return snap.library.length === 5000 && snap.records.size === 61 && !snap.compiling
          && [snap.indexLoad, snap.annotationsLoad, snap.commentsLoad].every(load => load.phase === "ready");
      }, undefined, { timeout: 60_000 });
      await page.getByRole("tab", { name: /Sources/ }).click();
      const search = page.locator(".sources input[type=search]");
      const timings = [];
      for (const [query, key] of [["source", "source00000"], ["synthetic research", "source00000"], ["source04999", "source04999"], ["author00124 2024", "source00124"]]) {
        const start = await page.evaluate(() => performance.now());
        await search.fill(query);
        await page.getByRole("list", { name: "Matching sources" }).locator(`.source-row[data-key="${key}"]`).first().waitFor();
        timings.push(await page.evaluate(start => performance.now() - start, start));
      }
      await search.fill("");
      await page.getByRole("tab", { name: "Outline", exact: true }).click();
      await page.locator(`.record-row[data-path="${chapter}"]`).click();
      const editor = page.getByRole("textbox", { name: `Markdown for ${chapter}`, exact: true });
      const original = await page.evaluate(path => window.writer.workspace.getSnapshot().records.get(path).snapshot.body, chapter);
      const chapterBytes = Buffer.byteLength(original);
      assert.ok(chapterBytes >= 50_000 && chapterBytes <= 100_000);
      await editor.focus();
      await page.keyboard.press("ControlOrMeta+End");
      await editor.evaluate(el => {
        window.inputFrames = [];
        el.addEventListener("beforeinput", () => {
          const start = performance.now();
          requestAnimationFrame(() => window.inputFrames.push(performance.now() - start));
        }, { capture: true });
      });
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Performance.enable", { timeDomain: "threadTicks" });
      const taskTime = async () => (await cdp.send("Performance.getMetrics")).metrics.find(metric => metric.name === "TaskDuration").value * 1000;
      if (process.env.PROFILE_CPU) {
        await cdp.send("Profiler.enable");
        await cdp.send("Profiler.start");
      }
      const phrase = "The archives show that";
      const taskStart = await taskTime();
      for (const [index, char] of [...phrase].entries()) {
        await page.keyboard.insertText(char);
        await page.waitForFunction(count => window.inputFrames.length === count, index + 1);
      }
      assert.equal(await page.evaluate(path => window.writer.workspace.getSnapshot().records.get(path).snapshot.body, chapter), original + phrase);
      const typingMainCpuMs = await taskTime() - taskStart;
      if (process.env.PROFILE_CPU) {
        const { profile: samples } = await cdp.send("Profiler.stop");
        await writeFile(`${process.env.PROFILE_CPU}-${run}.cpuprofile`, JSON.stringify(samples));
      }
      const frames = await page.evaluate(() => window.inputFrames);
      console.log(JSON.stringify({ run, chapterBytes, pickerMs: median(timings), pickerSamplesMs: timings, typingFrameMs: median(frames), typingP90Ms: [...frames].sort((a, b) => a - b)[Math.ceil(frames.length * .9) - 1], typingMainCpuMs }));
      assert.deepEqual(errors, []);
    } finally {
      await page.context().close();
    }
  }
} finally {
  await browser.close();
}
