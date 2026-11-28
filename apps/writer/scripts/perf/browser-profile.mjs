// Opt-in Chromium UI profile against DEV ?demo=large; never a real collection.
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import assert from "node:assert/strict";
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
const workers = []; page.on("worker", (worker) => workers.push(worker));
const cdp = await page.context().newCDPSession(page);
await cdp.send("Network.enable"); await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
await cdp.send("Network.setBypassServiceWorker", { bypass: true });
await cdp.send("Performance.enable");
if (process.env.PROFILE_CPU) { await cdp.send("Profiler.enable"); await cdp.send("Profiler.start"); }
await page.addInitScript(() => {
  window.uiTasks = [];
  window.workerProfile = { messages: [], events: [] };
  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      window.workerProfile.events.push({ type: "created", url: String(args[0]), at: performance.now() });
      this.addEventListener("message", ({ data }) => {
        window.workerProfile.events.push({ type: data.type, at: performance.now(), initMs: data.initMs, timings: data.timings });
      });
    }
    postMessage(message, ...args) {
      const start = performance.now(); super.postMessage(message, ...args);
      window.workerProfile.messages.push({ type: message.type, at: start, sendMs: performance.now() - start,
        items: message.library?.length, records: message.recordPaths?.length,
        // Only in the opt-in profiler: logical size, not wire bytes.
        bytes: message.type === "init" || message.type === "collection" ? new TextEncoder().encode(JSON.stringify(message)).length : undefined });
    }
  };
  new PerformanceObserver((list) => window.uiTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })))).observe({ type: "longtask", buffered: true });
  const watch = () => {
    if (!window.editorPaint && document.querySelector(".cm-content")?.getBoundingClientRect().height) window.editorPaint = performance.now();
    if (!window.previewPaint && document.querySelector(".preview-pages canvas.page")?.getBoundingClientRect().height) window.previewPaint = performance.now();
    if (!window.previewRendered && Number(document.querySelector(".preview-pages")?.dataset.renderedRevision) > 0) window.previewRendered = performance.now();
    if (!window.previewRendered) requestAnimationFrame(watch);
  }; requestAnimationFrame(watch);
});
const base = process.env.BASE ?? "http://127.0.0.1:5320/";
const report = { boundary: "Cold browser cache, in-memory SDK, Chromium main-thread long tasks. Editor and preview markers describe geometry and rendered revisions. Main CDP heap excludes workers and native/WASM backing storage.", phases: {} };
let phase = "startup";
const measure = async (name, run) => {
  phase = name;
  const start = await page.evaluate(() => performance.now());
  await run();
  const actionMs = await page.evaluate(start => performance.now() - start, start);
  await page.waitForTimeout(100);
  report.phases[name] = await page.evaluate(({ start, actionMs }) => {
    const tasks = window.uiTasks.filter((e) => e.start >= start);
    return { actionMs, elapsedMs: performance.now() - start, longTasks: tasks.length, totalLongTaskMs: tasks.reduce((n, e) => n + e.duration, 0), maxLongTaskMs: Math.max(0, ...tasks.map((e) => e.duration)), sourceRows: document.querySelectorAll(".source-row").length, highlights: document.querySelectorAll(".annotations > li").length, threads: document.querySelectorAll(".mdbase-threads > .mdbase-thread").length, replies: document.querySelectorAll(".mdbase-comment.is-reply").length, headings: document.querySelectorAll(".heading-row").length };
  }, { start, actionMs });
};
try {
  await page.goto(`${base}?demo=large&largeManuscript=1&manuscript=manuscripts/main.md`);
  await page.waitForFunction(() => {
    const workspace = window.writer?.workspace;
    if (!workspace || !window.editorPaint) return false;
    const snapshot = workspace.getSnapshot();
    const order = workspace.readingOrder();
    return order.length === 61 && order.every(path => snapshot.records.has(path)) && snapshot.commentsLoad.phase === "ready";
  }, null, { timeout: 120000 });
  report.paint = await page.evaluate(() => ({ editorMs: window.editorPaint, previewMs: window.previewPaint, renderedMs: window.previewRendered }));
  // An early self-contained preview can precede discovery. Compare retained heap
  // only after the same complete metadata workload, never a partial collection.
  await page.waitForFunction(() => ["indexLoad", "libraryLoad", "annotationsLoad", "commentsLoad"].every((key) => window.writer.workspace.getSnapshot()[key].phase === "ready"), null, { timeout: 120000 });
  report.fixture = await page.evaluate(() => {
    const workspace = window.writer.workspace;
    const snapshot = workspace.getSnapshot();
    return { chapters: workspace.readingOrder().length - 1, comments: snapshot.comments.length, sources: snapshot.library.length };
  });
  assert.deepEqual(report.fixture, { chapters: 60, comments: 300, sources: 5_000 });
  report.metadataReadyMs = await page.evaluate(() => performance.now());
  await page.waitForTimeout(100);
  report.heapAfterLoadBytes = (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSHeapUsedSize").value;
  report.startup = await page.evaluate(() => ({ timeOrigin: performance.timeOrigin, tasks: window.uiTasks, worker: window.workerProfile,
    resources: performance.getEntriesByType("resource").map(({ name, startTime, duration, transferSize }) => ({ name, startTime, duration, transferSize })) }));
  report.workers = await Promise.all(workers.map(async (worker) => ({ url: worker.url(), ...await worker.evaluate(() => ({
    timeOrigin: performance.timeOrigin, now: performance.now(),
    marks: performance.getEntriesByType("mark").map(({ name, startTime }) => ({ name, startTime })),
    resources: performance.getEntriesByType("resource").map(({ name, startTime, duration, transferSize }) => ({ name, startTime, duration, transferSize })),
  })) })));
  if (process.env.PROFILE_CPU) {
    const { profile } = await cdp.send("Profiler.stop");
    mkdirSync(dirname(process.env.PROFILE_CPU), { recursive: true });
    writeFileSync(process.env.PROFILE_CPU, JSON.stringify(profile));
  }
  await cdp.send("HeapProfiler.collectGarbage");
  report.heapAfterGCBytes = (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "JSHeapUsedSize").value;
  // Dedicated workers aren't included in the page's Performance metrics.
  const browserCdp = await browser.newBrowserCDPSession();
  report.workerHeaps = [];
  for (const target of (await browserCdp.send("Target.getTargets")).targetInfos.filter((t) => t.type === "worker")) {
    const { sessionId } = await browserCdp.send("Target.attachToTarget", { targetId: target.targetId });
    let id = 0;
    const request = (method) => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timeout = setTimeout(() => { browserCdp.off("Target.receivedMessageFromTarget", receive); reject(new Error(`Worker ${method} timed out`)); }, 60000);
      const receive = (event) => {
        if (event.sessionId !== sessionId) return;
        const response = JSON.parse(event.message);
        if (response.id !== requestId) return;
        clearTimeout(timeout);
        browserCdp.off("Target.receivedMessageFromTarget", receive);
        response.error ? reject(new Error(response.error.message)) : resolve(response.result);
      };
      browserCdp.on("Target.receivedMessageFromTarget", receive);
      void browserCdp.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: requestId, method }) }).catch(reject);
    });
    await request("HeapProfiler.collectGarbage");
    report.workerHeaps.push({ url: target.url, ...await request("Runtime.getHeapUsage") });
    if (process.env.PROFILE_WORKER_HEAP) {
      const chunks = [];
      const receive = (event) => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.method === "HeapProfiler.addHeapSnapshotChunk") chunks.push(message.params.chunk);
      };
      browserCdp.on("Target.receivedMessageFromTarget", receive);
      await request("HeapProfiler.takeHeapSnapshot");
      browserCdp.off("Target.receivedMessageFromTarget", receive);
      const output = `${process.env.PROFILE_WORKER_HEAP}-${target.targetId}.heapsnapshot`;
      mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, chunks.join(""));
      report.workerHeaps.at(-1).snapshot = output;
    }
    await browserCdp.send("Target.detachFromTarget", { sessionId });
  }
  await browserCdp.detach();
  if (process.env.PROFILE_HEAP) {
    const chunks = []; cdp.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => chunks.push(chunk));
    await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
    mkdirSync(dirname(process.env.PROFILE_HEAP), { recursive: true });
    writeFileSync(process.env.PROFILE_HEAP, chunks.join(""));
  }
  const editor = page.locator(".cm-content");
  const editorEnd = async () => {
    await editor.focus();
    await page.keyboard.press("ControlOrMeta+End");
  };
  const type = async (path) => {
    const original = await page.evaluate(path => window.writer.workspace.getSnapshot().records.get(path).snapshot.body, path);
    await editorEnd();
    for (let i = 0; i < 12; i++) await page.keyboard.insertText(" ordinary typing");
    await page.waitForFunction(({ path, original }) => window.writer.workspace.getSnapshot().records.get(path).snapshot.body === original + " ordinary typing".repeat(12), { path, original });
  };
  const main = "manuscripts/main.md";
  const chapter = index => `chapters/chapter-${String(index).padStart(5, "0")}.md`;
  await page.getByRole("tab", { name: "Outline", exact: true }).click();
  await measure("switchChapters", async () => {
    for (const index of [1, 7, 22, 0]) {
      const path = chapter(index);
      await page.locator(`.record-row[data-path="${path}"]`).click();
      await page.locator(".pane-path", { hasText: path }).waitFor();
    }
  });
  await measure("typingOutline", () => type(chapter(0)));
  phase = "openMain";
  await page.locator(".outline-manuscript").click();
  await page.locator('.cm-content[aria-label="Markdown for ' + main + '"]').waitFor();
  await page.getByRole("tab", { name: /Comments/ }).click();
  await page.locator(".mdbase-threads > .mdbase-thread").first().waitFor();
  await measure("typingComments", () => type(main));
  mkdirSync("out", { recursive: true });
  await page.screenshot({ path: "out/large-comments-" + (process.env.PROFILE_NAME ?? "profile") + ".png" });
  await page.getByRole("tab", { name: /Sources/ }).click();
  await measure("typingSources", () => type(main));
  await measure("showAllSources", async () => {
    const all = page.getByRole("button", { name: /^Show all/ });
    if (await all.count()) await all.click(); else await page.getByRole("button", { name: /^Show 50 more sources/ }).click();
  });
  await measure("filterSources", async () => {
    await page.getByRole("searchbox", { name: "Find a source" }).fill("source00000");
    await page.getByRole("list", { name: "Matching sources" }).locator('[data-key="source00000"]').waitFor();
  });
  await measure("expand300Highlights", async () => {
    await page.locator('.source-row[data-key="source00000"]').click();
    await page.locator(".annotations > li").first().waitFor();
  });
  await page.screenshot({ path: "out/large-sources-" + (process.env.PROFILE_NAME ?? "profile") + ".png" });
  await measure("docxExport", async () => {
    const download = page.waitForEvent("download", { timeout: 120000 });
    await page.getByRole("button", { name: "Export formats" }).click();
    await page.getByRole("menuitem").filter({ has: page.getByText("Word (DOCX)", { exact: true }) }).click();
    const review = page.getByRole("button", { name: "Export anyway", exact: true });
    if (await Promise.race([download.then(() => false), review.waitFor({ timeout: 120000 }).then(() => true)])) await review.click();
    const bytes = readFileSync(await (await download).path());
    assert.equal(bytes.subarray(0, 4).toString("hex"), "504b0304");
    assert.ok(bytes.includes(Buffer.from("word/document.xml")), "DOCX is missing its document part");
    report.docxBytes = bytes.length;
  });
  await page.getByRole("tab", { name: "Outline", exact: true }).click();
  const outlineSearch = page.getByRole("searchbox", { name: "Search outline" });
  const results = page.locator(".search-hit");
  await measure("searchOutlineSparse", async () => {
    await outlineSearch.fill("Evidence in chapter 60, section 8");
    await results.first().waitFor();
    assert.equal(await results.count(), 1);
  });
  await measure("searchOutlineBroad", async () => {
    await outlineSearch.fill("supports the manuscript");
    await page.waitForFunction(() => document.querySelectorAll(".search-hit").length === 480, null, { timeout: 60_000 });
  });
  // Use concrete prefixes so completion waits for results from the large index.
  for (const [name, input] of [["citeCompletion", " [@source000"], ["embedCompletion", "\n![[chapters/chapter-000"]]) {
    await measure(name, async () => {
      await editorEnd();
      await page.keyboard.type(input, { delay: 20 });
      await page.locator(".cm-tooltip-autocomplete li").first().waitFor({ timeout: 10_000 });
    });
    await page.keyboard.press("Escape");
    await page.keyboard.press("ControlOrMeta+z");
  }
} catch (error) {
  report.failure = {
    phase, message: String(error),
    ...(await page.evaluate(() => ({
      search: document.querySelector(".manuscript-search input")?.value,
      summary: document.querySelector(".search-summary")?.textContent,
      hits: document.querySelectorAll(".search-hit").length,
    })).catch(() => ({}))),
  };
  throw error;
} finally {
  report.errors = errors;
  const output = process.env.PROFILE_OUTPUT ?? "out/perf/browser-profile.json";
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
  await browser.close();
}
