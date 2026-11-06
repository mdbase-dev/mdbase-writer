// Real production React + Preview canvas regression; no account or service.
// Build first: pnpm build:editing-test, then node scripts/browser-editing-test.mjs.
import assert from "node:assert/strict";
import http from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadavg } from "node:os";

const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(app, "dist");
const compiler = join(app, "node_modules/@myriaddreamin/typst-ts-web-compiler");
const { version } = JSON.parse(await readFile(join(compiler, "package.json"), "utf8"));
const mime = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".otf": "font/otf", ".ttf": "font/ttf", ".woff2": "font/woff2" };
// Pages serves the oversized compiler from R2. This isolated test serves the
// exact installed compiler instead, without credentials or external requests.
const server = http.createServer(async (request, response) => {
  try {
    const requested = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = requested === `/wasm/typst_ts_web_compiler-${version}.wasm`
      ? join(compiler, "pkg/typst_ts_web_compiler_bg.wasm")
      : join(root, requested === "/" ? "index.html" : requested);
    if (!file.startsWith(`${root}/`) && file !== join(compiler, "pkg/typst_ts_web_compiler_bg.wasm")) throw new Error("Invalid test asset path");
    const bytes = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
    response.end(bytes);
  } catch { response.writeHead(404); response.end("Not found"); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.CHROME });
  const tracing = await browser.newBrowserCDPSession();
  await tracing.send("Tracing.start", { categories: "disabled-by-default-v8.cpu_profiler", transferMode: "ReturnAsStream" });
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url().startsWith(`${base}/`) ? route.continue() : route.abort());
  const page = await context.newPage();
  const blank = await page.evaluate(() => new Promise(resolve => {
    const frames = []; let last = performance.now();
    const sample = now => { frames.push(now - last); last = now; if (frames.length < 30) requestAnimationFrame(sample); else resolve(frames.slice(1)); };
    requestAnimationFrame(sample);
  }));
  const load = loadavg();
  await page.addInitScript(() => {
    window.previewProfile = [];
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(...args) {
        super(...args);
        this.addEventListener("message", ({ data }) => {
          if (data.type === "ready" || data.type === "result") window.previewProfile.push({ elapsed: performance.now(), type: data.type, initMs: data.initMs, timings: data.timings });
        });
      }
    };
  });
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.stack ?? error.message));
  const painted = () => page.waitForFunction(() => {
    const snapshot = window.writer?.workspace?.getSnapshot();
    return snapshot?.artifact && !snapshot.compiling && Number(document.querySelector(".preview-pages")?.dataset.renderedRevision) === snapshot.artifactRevision && document.querySelector(".preview canvas[data-version]");
  }, undefined, { timeout: 60_000 });
  const body = () => page.evaluate(() => { const workspace = window.writer.workspace; return workspace.getSnapshot().records.get(workspace.main).snapshot.body; });
  await page.goto(`${base}/?demo`);
  await page.locator('.manuscript-row[data-path="manuscripts/patient-observation.md"]').waitFor();
  const opened = await page.evaluate(() => performance.now());
  await page.locator('.manuscript-row[data-path="manuscripts/patient-observation.md"]').click();
  await page.locator('.cm-content[contenteditable=true]').waitFor();
  const editorMs = await page.evaluate(opened => performance.now() - opened, opened);
  await painted();
  const profile = await page.evaluate(() => ({ paintedMs: performance.now(), messages: window.previewProfile, resources: performance.getEntriesByType("resource").map(({ name, startTime, duration, transferSize }) => ({ name: new URL(name).pathname, startTime, duration, transferSize })) }));
  Object.assign(profile, { build: "production demo-test", load, blank, editorMs, clickToDrawnMs: profile.paintedMs - opened });
  profile.workers = await Promise.all(page.workers().map(worker => worker.evaluate(() => performance.getEntriesByType("resource").map(({ name, startTime, duration, transferSize }) => ({ name: new URL(name).pathname, startTime, duration, transferSize })))));
  await mkdir("out/editing", { recursive: true });
  await writeFile("out/editing/first-preview.json", JSON.stringify(profile, null, 2));
  const completedTrace = new Promise(resolve => tracing.once("Tracing.tracingComplete", resolve));
  await tracing.send("Tracing.end");
  const { stream } = await completedTrace;
  let trace = "";
  for (;;) {
    const chunk = await tracing.send("IO.read", { handle: stream });
    trace += chunk.data;
    if (chunk.eof) break;
  }
  await tracing.send("IO.close", { handle: stream });
  await writeFile("out/editing/first-preview-trace.json", trace);
  console.log(`production first preview: ${Math.round(profile.paintedMs)}ms; compiler ready: ${Math.round(profile.messages.find(message => message.type === "ready")?.initMs)}ms`);
  await page.locator(".outline-manuscript").click();
  const editor = page.locator(".cm-content[contenteditable=true]");
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(`# Long editing test\n\n## Section one\n\n${"A sentence with several words. ".repeat(380)}\n\n## Section two\n\n- First item\n- Second item\n\n[Link](https://example.com)\n`);
  assert.match(await body(), /^# Long editing test/);
  await painted();
  for (let round = 0; round < 4; round++) {
    await page.keyboard.press("Control+End");
    await page.keyboard.type(" More text to exercise cursor changes, ordinary typing, undo and redo. ".repeat(4), { delay: 1 });
    const typed = await body();
    for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
    for (let i = 0; i < 3; i++) await page.keyboard.press("Control+y");
    assert.equal(await body(), typed, "Undo/redo must preserve the final text");
    await painted();
  }
  assert.deepEqual(errors, [], "Typing with a real canvas must not log React/CodeMirror errors");
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(`# Long profile\n\n${"A sentence with several words. ".repeat(2200)}`);
  await painted();
  const cpu = await context.newCDPSession(page);
  await cpu.send("Profiler.enable");
  await cpu.send("Profiler.start");
  const typingLoad = loadavg();
  await page.evaluate(() => {
    window.typingFrames = [];
    document.addEventListener("keydown", event => {
      if (event.key.length !== 1) return;
      const started = performance.now();
      requestAnimationFrame(() => window.typingFrames.push(performance.now() - started));
    });
  });
  const beforeTyping = await body();
  const profileText = " Profile ordinary typing in a long document. ";
  await page.keyboard.type(profileText, { delay: 25 });
  assert.equal(await body(), beforeTyping + profileText, "Profiled typing must retain every character");
  const typingProfile = await cpu.send("Profiler.stop");
  const frames = await page.evaluate(() => window.typingFrames);
  const sorted = [...frames].sort((left, right) => left - right);
  await writeFile("out/editing/typing-profile.json", JSON.stringify(typingProfile));
  await writeFile("out/editing/typing.json", JSON.stringify({ words: 11000, load: typingLoad, frames, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) }, null, 2));
  console.log("ok    production editing, cursor movement and undo/redo with a real Preview canvas");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
