// Keystroke → painted preview in the real app (demo mode), one character at a time.
import { chromium } from "playwright";
const [manuscript = "manuscripts/slow-change.md", record = manuscript, needle = "too slow to watch", n = "12"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const t0 = Date.now();
await page.goto(`http://127.0.0.1:5320/?demo&manuscript=${encodeURIComponent(manuscript)}`);
await page.waitForFunction(() => Number(document.querySelector(".preview-pages")?.dataset.renderedRevision ?? 0) > 0 && !window.writer.workspace.getSnapshot().compiling && window.writer.workspace.getSnapshot().result?.unloaded.length === 0, null, { timeout: 60000 });
const ready = Date.now() - t0;
if (record !== manuscript) await page.locator(".record-row", { hasText: record.split("/").pop().replace(".md", "") }).first().click();
await page.locator(".cm-line", { hasText: needle }).first().click();
await page.keyboard.press("End");
const samples = [];
const renders = [];
for (let i = 0; i < Number(n); i++) {
  const rev = await page.evaluate(() => window.writer.workspace.getSnapshot().result.revision);
  const start = Date.now();
  await page.keyboard.type("x");
  await page.waitForFunction((r) => { const s = window.writer.workspace.getSnapshot(); return s.result.revision > r && !s.compiling && Number(document.querySelector(".preview-pages").dataset.renderedRevision) === s.artifactRevision; }, rev, { timeout: 30000 });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  samples.push(Date.now() - start);

}
const s = samples.slice(2).sort((a, b) => a - b);
const t = await page.evaluate(() => window.writer.workspace.getSnapshot().result.timings);
console.log(JSON.stringify({ manuscript, pages: await page.evaluate(() => document.querySelectorAll(".preview-pages canvas.page").length), readyMs: ready, p50: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))], last: t }));
await browser.close();
