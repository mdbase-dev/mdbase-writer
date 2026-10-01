// Opt-in Chromium UI profile against DEV ?demo=large; never a real collection.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/home/calluma/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell" });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.uiTasks = [];
  new PerformanceObserver((list) => window.uiTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })))).observe({ type: "longtask", buffered: true });
  const watch = () => {
    if (!window.editorPaint && document.querySelector(".cm-content")?.getBoundingClientRect().height) window.editorPaint = performance.now();
    if (!window.previewPaint && document.querySelector(".preview-pages canvas.page")?.getBoundingClientRect().height) window.previewPaint = performance.now();
    if (!window.previewPaint) requestAnimationFrame(watch);
  }; requestAnimationFrame(watch);
});
const base = process.env.BASE ?? "http://127.0.0.1:5320/";
const report = { boundary: "Chromium main-thread long tasks; visible editor/canvas at animation frame (not pixel verification); CDP JS heap excludes workers/WASM; synthetic transport 20ms pages", phases: {} };
const measure = async (name, run) => {
  const start = await page.evaluate(() => performance.now()); await run(); await page.waitForTimeout(100);
  report.phases[name] = await page.evaluate((start) => {
    const tasks = window.uiTasks.filter((e) => e.start >= start);
    return { elapsedMs: performance.now() - start, longTasks: tasks.length, totalLongTaskMs: tasks.reduce((n, e) => n + e.duration, 0), maxLongTaskMs: Math.max(0, ...tasks.map((e) => e.duration)), sourceRows: document.querySelectorAll(".source-row").length, highlights: document.querySelectorAll(".annotations > li").length, threads: document.querySelectorAll(".threads > .thread").length, replies: document.querySelectorAll(".comment.is-reply").length, headings: document.querySelectorAll(".heading-row").length };
  }, start);
};
try {
  await page.goto(`${base}?demo=large&manuscript=manuscripts/main.md`);
  await page.waitForFunction(() => window.previewPaint && window.writer.workspace.getSnapshot().commentsLoad.phase === "ready", null, { timeout: 120000 });
  report.paint = await page.evaluate(() => ({ editorMs: window.editorPaint, previewMs: window.previewPaint }));
  const cdp = await page.context().newCDPSession(page); await cdp.send("Performance.enable");
  report.heapAfterLoadBytes = (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSHeapUsedSize").value;
  await page.getByRole("tab", { name: /Sources/ }).click();
  const type = async () => {
    await page.locator(".cm-content").click(); await page.keyboard.press("ControlOrMeta+End");
    const until = Date.now() + 10000;
    while (Date.now() < until) { await page.keyboard.type(" ordinary typing", { delay: 25 }); await page.waitForTimeout(75); }
  };
  await measure("typingSources10s", type);
  await measure("showAllSources", async () => {
    const all = page.getByRole("button", { name: /^Show all/ });
    if (await all.count()) await all.click(); else await page.getByRole("button", { name: /^Show 50 more sources/ }).click();
  });
  await page.locator(".sources input[type=search]").fill("source00000");
  await measure("expand300Highlights", async () => { await page.locator('.source-row[data-key="source00000"]').click(); await page.locator(".annotations > li").first().waitFor(); });
  for (const [name, text] of [["citeCompletion", " [@"], ["embedCompletion", "\n![["]]) {
    await measure(name, async () => { await page.locator(".cm-content").click(); await page.keyboard.press("ControlOrMeta+End"); await page.keyboard.type(text); await page.locator(".cm-tooltip-autocomplete").waitFor(); });
    await page.keyboard.press("Escape"); await page.keyboard.press("ControlOrMeta+z");
  }
  await page.getByRole("tab", { name: /Comments/ }).click();
  await measure("typingComments10s", type);
  mkdirSync("out", { recursive: true }); await page.screenshot({ path: "out/large-comments-" + (process.env.PROFILE_NAME ?? "profile") + ".png" });
  await page.getByRole("tab", { name: /Sources/ }).click(); await page.screenshot({ path: "out/large-sources-" + (process.env.PROFILE_NAME ?? "profile") + ".png" });
  report.errors = errors;
  writeFileSync(process.env.PROFILE_OUTPUT ?? "scripts/perf/browser-profile.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} finally { await browser.close(); }
