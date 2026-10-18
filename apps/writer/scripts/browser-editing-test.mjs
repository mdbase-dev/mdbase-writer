// Real production React + Preview canvas regression; no account or service.
// Build first: pnpm build:editing-test, then node scripts/browser-editing-test.mjs.
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

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
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url().startsWith(`${base}/`) ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(error.stack ?? error.message));
  const painted = () => page.waitForFunction(() => {
    const snapshot = window.writer?.workspace?.getSnapshot();
    return snapshot?.artifact && !snapshot.compiling && Number(document.querySelector(".preview-pages")?.dataset.renderedRevision) === snapshot.artifactRevision && document.querySelector(".preview canvas[data-version]");
  }, undefined, { timeout: 60_000 });
  const body = () => page.evaluate(() => { const workspace = window.writer.workspace; return workspace.getSnapshot().records.get(workspace.main).snapshot.body; });
  await page.goto(`${base}/?demo&manuscript=manuscripts%2Fpatient-observation.md`);
  await painted();
  const editor = page.locator(".cm-content[contenteditable=true]");
  await editor.click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(`# Long editing test\n\n## Section one\n\n${"A sentence with several words. ".repeat(380)}\n\n## Section two\n\n- First item\n- Second item\n\n[Link](https://example.com)\n`);
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
  console.log("ok    production editing, cursor movement and undo/redo with a real Preview canvas");
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
