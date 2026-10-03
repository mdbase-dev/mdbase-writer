// Failure-path regression tests against the isolated in-memory demo, not a user's collection.
// Run with the development server: node scripts/browser-reliability-test.mjs [base URL]
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:5320/";
const browser = await chromium.launch({ executablePath: process.env.CHROME });
mkdirSync("out", { recursive: true });
let failures = 0;
const main = "manuscripts/patient-observation.md";
async function scenario(name, run) {
  const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
  const page = await context.newPage();
  if (process.env.COLD_CACHE) {
    await context.route("**/*", (route) => route.continue());
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
  }
  try { await run(page); console.log(`ok    ${name}`); }
  catch (error) {
    failures++;
    console.error(`FAIL  ${name}: ${error.message}`);
    await page.screenshot({ path: `out/reliability-${name.replace(/\W+/g, "-")}.png` });
  } finally { await context.close(); }
}
const open = async (page) => {
  await page.goto(`${base}?demo&manuscript=${encodeURIComponent(main)}`);
  await page.waitForFunction(() => window.writer?.workspace?.getSnapshot().phase === "ready");
};
const painted = (page) => page.waitForFunction(() => {
  const snap = window.writer?.workspace?.getSnapshot();
  return snap?.artifact && !snap.compiling && Number(document.querySelector(".preview-pages")?.dataset.renderedRevision) === snap.artifactRevision;
});
const body = (page, path) => page.evaluate((path) => window.writer.workspace.getSnapshot().records.get(path).snapshot.body, path);
const format = async (page, name) => {
  await page.getByRole("button", { name: "Export formats" }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
};
try {
  await scenario("large lists page and keyboard navigation reveals logical rows; Sources survives tab switches", async (page) => {
    await page.goto(`${base}?demo=large`);
    await page.locator(".manuscript-row").first().waitFor();
    assert.equal(await page.locator(".manuscript-row").count(), 50);
    await page.getByRole("button", { name: /^Show 50 more manuscripts/ }).click();
    assert.equal(await page.locator(".manuscript-row").count(), 100);
    await page.locator('.manuscript-row[data-path="manuscripts/main.md"]').click();
    await painted(page);
    await page.getByRole("tab", { name: /Sources/ }).click();
    const cited = page.getByRole("list", { name: "In this manuscript" });
    assert.equal(await cited.locator(".source-row").count(), 50);
    await cited.locator(".source-row").last().focus(); await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.activeElement?.getAttribute("data-key") === "source00050");
    assert.equal(await cited.locator(".source-row").count(), 50);
    await page.locator(".sources input[type=search]").fill("source00000");
    await page.locator('.source-row[data-key="source00000"]').click();
    await page.locator(".annotations > li").first().waitFor();
    assert.equal(await page.locator(".annotations > li").count(), 50);
    await page.getByRole("button", { name: /^Show 50 more highlights/ }).click();
    assert.equal(await page.locator(".annotations > li").count(), 100);
    await page.locator(".sidebar-panel").evaluate((el) => { el.scrollTop = 200; });
    const scroll = await page.locator(".sidebar-panel").evaluate((el) => el.scrollTop);
    await page.getByRole("tab", { name: /Comments/ }).click();
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().commentsLoad.phase === "ready");
    assert.equal(await page.locator(".threads > .thread").count(), 50);
    assert.equal(await page.locator(".comment.is-reply").count(), 50);
    await page.getByRole("button", { name: /^Show 50 more replies/ }).click();
    assert.equal(await page.locator(".comment.is-reply").count(), 100);
    await page.locator(".threads > .thread").first().getByRole("button", { name: "Reply", exact: true }).click();
    await page.getByRole("textbox", { name: "Reply", exact: true }).fill("A draft to keep while paging");
    const nextThread = await page.evaluate(async () => {
      const { placeThreads } = await import("/src/ui/comments.ts");
      const w = window.writer.workspace, snap = w.getSnapshot();
      return placeThreads(snap.comments, w.readingOrder(), (p) => snap.records.get(p)?.snapshot.body, snap.recordIndex).filter((p) => p.thread.root.status === "open")[50].thread.root.path;
    });
    await page.locator(".threads > .thread .thread-anchor").last().focus(); await page.keyboard.press("j");
    await page.waitForFunction((path) => document.activeElement?.closest("[data-thread]")?.getAttribute("data-thread") === path, nextThread);
    await page.getByRole("tab", { name: /Sources/ }).click();
    assert.equal(await page.locator(".sources input[type=search]").inputValue(), "source00000");
    assert.equal(await page.locator('.source-row[data-key="source00000"]').getAttribute("aria-expanded"), "true");
    assert.equal(await page.locator(".annotations > li").count(), 100);
    assert.ok(Math.abs(await page.locator(".sidebar-panel").evaluate((el) => el.scrollTop) - scroll) < 3);
    await page.getByRole("tab", { name: /Comments/ }).click();
    assert.equal(await page.getByRole("textbox", { name: "Reply", exact: true }).inputValue(), "A draft to keep while paging");
    await page.getByRole("tab", { name: "Outline", exact: true }).click();
    await page.locator(".heading-row").first().waitFor();
    assert.equal(await page.locator(".heading-row").count(), 50);
    await page.locator(".heading-row").last().focus(); await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.activeElement?.textContent.includes("Section 49"));
  });

  await scenario("editing opens before slow collection enumeration and export waits", async (page) => {
    await page.goto(`${base}?demo`);
    await page.locator(".manuscript-row").first().waitFor();
    await page.evaluate(async () => {
      const backend = window.writer.backend;
      const [index, library] = await Promise.all([backend.index(), backend.library()]);
      backend.index = () => new Promise((resolve) => { window.finishIndex = () => resolve(index); });
      backend.library = () => new Promise((resolve) => { window.finishLibrary = () => resolve(library); });
    });
    await page.locator(".manuscript-row", { hasText: "Patient Observation" }).click();
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().phase === "ready");
    await page.locator(".cm-content").waitFor();
    await page.getByText("Dependencies not checked").waitFor();
    const loading = await page.evaluate(() => {
      const w = window.writer.workspace, snap = w.getSnapshot();
      w.setBody(w.main, snap.records.get(w.main).snapshot.body + "\n\nWriting while discovery waits.");
      window.exportSettled = false;
      window.exportJob = w.exportBundle().then(() => { window.exportSettled = true; });
      return [snap.indexLoad.phase, snap.libraryLoad.phase, w.dependencyDiagnostics()];
    });
    assert.deepEqual(loading, ["loading", "loading", []]);
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.exportSettled), false);
    assert.match(await body(page, main), /Writing while discovery waits/);
    await page.evaluate(() => { window.finishIndex(); window.finishLibrary(); });
    await page.evaluate(() => window.exportJob);
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().records.has("chapters/worms.md"));
  });

  await scenario("self-contained preview does not wait for the collection index; exports do", async (page) => {
    await page.goto(`${base}?demo`);
    await page.locator(".manuscript-row").first().waitFor();
    await page.evaluate(async (path) => {
      const backend = window.writer.backend;
      const index = await backend.index();
      backend.authority.editElsewhere(path, { body: "# Self-contained\n\nA plain paragraph.\n" });
      backend.index = () => new Promise((resolve) => { window.finishIndex = () => resolve(index); });
    }, main);
    await page.locator(".manuscript-row", { hasText: "Patient Observation" }).click();
    await painted(page);
    assert.equal(await page.evaluate(() => window.writer.workspace.getSnapshot().indexLoad.phase), "loading");
    await page.getByText("Dependencies not checked").waitFor();
    await page.evaluate(() => {
      window.exportFinished = false;
      window.pendingBundle = window.writer.workspace.exportBundle().then(() => { window.exportFinished = true; });
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.exportFinished), false);
    await page.evaluate(async () => { window.finishIndex(); await window.pendingBundle; });
    assert.equal(await page.evaluate(() => window.writer.workspace.getSnapshot().indexLoad.phase), "ready");
  });

  await scenario("preview starts while annotation discovery is held", async (page) => {
    await page.goto(`${base}?demo`);
    await page.locator(".manuscript-row").first().waitFor();
    await page.evaluate(() => {
      const backend = window.writer.backend, original = backend.annotationPaths.bind(backend);
      backend.annotationPaths = () => new Promise((resolve) => { window.finishAnnotations = () => original().then(resolve); });
    });
    await page.locator(".manuscript-row", { hasText: "Patient Observation" }).click();
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().phase === "ready");
    await painted(page);
    assert.equal(await page.evaluate(() => window.writer.workspace.getSnapshot().annotationsLoad.phase), "loading");
    await page.evaluate(() => window.finishAnnotations());
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().annotationsLoad.phase === "ready");
  });

  await scenario("annotation discovery failures leave preview and warned exports available", async (page) => {
    await page.goto(`${base}?demo`);
    await page.locator(".manuscript-row").first().waitFor();
    await page.evaluate(() => {
      const backend = window.writer.backend, original = backend.annotationPaths.bind(backend);
      let attempts = 0;
      backend.annotationPaths = () => attempts++ === 0 ? Promise.reject(new Error("Temporary annotation discovery failure")) : original();
    });
    await page.locator(".manuscript-row", { hasText: "Patient Observation" }).click();
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().phase === "ready");
    await painted(page);
    assert.equal(await page.evaluate(() => window.writer.workspace.getSnapshot().annotationsLoad.phase), "failed");
    const problems = await page.evaluate(async () => (await window.writer.workspace.exportBundle()).problems);
    assert.ok(problems.some((p) => p.includes("Temporary annotation discovery failure")));
    await page.getByRole("button", { name: "Retry loading" }).click();
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().annotationsLoad.phase === "ready");
  });

  await scenario("source annotations reject visibly, retry and invalidate while expanded", async (page) => {
    await open(page); await painted(page);
    await page.evaluate(() => {
      const backend = window.writer.backend, original = backend.annotationsForSource.bind(backend);
      let attempts = 0;
      backend.annotationsForSource = async (path) => {
        if (attempts++ === 0) throw new Error("Temporary highlight read failure");
        return original(path);
      };
    });
    await page.getByRole("tab", { name: /Sources/ }).click();
    await page.locator(".sources input[type=search]").fill("vegetable mould");
    await page.locator('.source-row[data-key="darwinFormation81"]').click();
    await page.getByRole("button", { name: "Retry annotations" }).waitFor();
    await page.getByRole("button", { name: "Retry annotations" }).click();
    await page.locator(".annotations blockquote", { hasText: "It may be doubted" }).waitFor();
    await page.evaluate(() => window.writer.backend.authority.editElsewhere("annotations/darwin-worms-history.md", { body: "> Changed Reader quotation\n" }));
    await page.locator(".annotations blockquote", { hasText: "Changed Reader quotation" }).waitFor();
    assert.equal(await page.locator(".annotations blockquote", { hasText: "It may be doubted" }).count(), 0);
  });

  await scenario("Home keeps manuscript errors separate from background sources and retries", async (page) => {
    await page.goto(`${base}?demo`);
    await page.locator(".manuscript-row").first().waitFor();
    await page.evaluate(() => {
      const backend = window.writer.backend;
      window.originalLibrary = backend.library.bind(backend);
      backend.library = async () => ({ ok: false, message: "Temporary background source failure" });
      window.dispatchEvent(new Event("focus"));
    });
    await page.getByRole("alert").filter({ hasText: "Temporary background source failure" }).waitFor();
    assert.ok(await page.locator(".manuscript-row").count() > 0);
    await page.evaluate(() => { window.writer.backend.library = window.originalLibrary; });
    await page.getByRole("button", { name: "Retry background data" }).click();
    await page.waitForFunction(() => !document.body.textContent.includes("Temporary background source failure"));
  });

  await scenario("source deltas update cited preview output without a manuscript edit", async (page) => {
    await open(page); await painted(page);
    const before = await body(page, main);
    await page.evaluate(() => {
      const backend = window.writer.backend;
      const source = window.writer.workspace.getSnapshot().library.find((entry) => entry.key === "darwinFormation81");
      // Demo CSL entries can be virtual (library.json); give this one a real record.
      if (!backend.authority.get(source.path)) backend.authority.seed(source.path, { frontmatter: { type: "reader-source", csl: source.item }, body: "Source record" });
      const record = backend.authority.get(source.path);
      backend.authority.editElsewhere(source.path, { patch: { ...record.frontmatter, csl: { ...source.item, title: "Revised cited source title" } } });
    });
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().result?.references.some((ref) => ref.key === "darwinFormation81" && ref.text.toLowerCase().includes("revised cited source title")));
    await painted(page);
    assert.equal(await body(page, main), before);
  });

  await scenario("chapter switching retains undo redo selection and scroll", async (page) => {
    await open(page); await painted(page);
    const chapter = "chapters/worms.md";
    await page.locator(`.record-row[data-path="${chapter}"]`).click();
    await page.evaluate((chapter) => { const workspace = window.writer.workspace; workspace.setBody(chapter, workspace.getSnapshot().records.get(chapter).snapshot.body + Array.from({ length: 100 }, (_, i) => `\n\nParagraph ${i + 1} for scroll continuity.`).join("")); }, chapter);
    const before = await body(page, chapter);
    await page.locator(".cm-content").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Retained history marker.");
    await page.waitForTimeout(100);
    const scroll = await page.locator(".cm-scroller").evaluate((el) => el.scrollTop);
    assert.ok(scroll > 0);
    const visibleAnchor = () => page.locator(".cm-scroller").evaluate((el) => {
      const top = el.getBoundingClientRect().top;
      const line = [...el.querySelectorAll(".cm-line")].find((line) => line.textContent && line.getBoundingClientRect().bottom > top);
      return { text: line.textContent, y: line.getBoundingClientRect().top - top };
    });
    const anchor = await visibleAnchor();
    await page.locator('.record-row[data-path="chapters/reefs.md"]').click();
    await page.locator(`.record-row[data-path="${chapter}"]`).click();
    await page.waitForTimeout(100);
    const restored = await visibleAnchor();
    // Absolute scrollTop changes when a virtualised document is remeasured.
    // The user's visible text and its viewport position must stay the same.
    assert.equal(restored.text, anchor.text);
    assert.ok(Math.abs(restored.y - anchor.y) < 2, `Visible text moved from ${anchor.y} to ${restored.y}`);
    await page.locator(".cm-content").evaluate((el) => el.focus({ preventScroll: true }));
    await page.keyboard.press("ControlOrMeta+z");
    assert.equal(await body(page, chapter), before);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    assert.match(await body(page, chapter), /Retained history marker/);
    await page.keyboard.type(" Cursor kept.");
    assert.equal((await body(page, chapter)).endsWith("Retained history marker. Cursor kept."), true);
  });

  await scenario("preview has positioned selectable accessible text and sanitizes active markup", async (page) => {
    await open(page); await painted(page);
    await page.waitForFunction(() => document.querySelector(".typst-content-text")?.textContent?.includes("Patient"));
    const result = await page.evaluate(async () => {
      const span = document.querySelector(".typst-content-text");
      const canvas = span.closest(".preview-page").querySelector("canvas");
      const a = span.getBoundingClientRect(), b = canvas.getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(span);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const { semanticLayer } = await import("/src/preview/semantics.ts");
      const safe = semanticLayer('<span onclick="alert(1)">safe</span><script>alert(1)</script><a href="javascript:alert(1)">link</a>');
      return { selected: selection.toString(), positioned: a.left > b.left && a.top > b.top && a.bottom <= b.bottom, safe: !safe.querySelector("script,[onclick],[href]") };
    });
    assert.equal(result.selected, "Patient Observation");
    assert.equal(result.positioned, true);
    assert.equal(result.safe, true);
    await page.getByRole("region", { name: "Page 1", exact: true }).focus();
  });

  for (const [name, pattern, retryName] of [
    ["compiler font failure leaves writing available and retries", "**/fonts/LibertinusSerif-Regular.otf", "Retry preview"],
    ["stylesheet HTTP failure is retryable without reopening the editor", "**/chicago-notes-bibliography.csl*", "Retry preview"],
    ["renderer HTTP failure is visible and retryable", "**/*typst_ts_renderer_bg.wasm*", "Retry rendering"],
  ]) await scenario(name, async (page) => {
    let failed = false;
    await page.route(pattern, async (route) => {
      // Vite also imports URL modules as scripts. Fail the asset download,
      // not the app's module graph (which would prevent React from starting).
      if (route.request().resourceType() !== "fetch") return route.continue();
      if (!failed) { failed = true; await route.fulfill({ status: 503, body: "Temporary failure" }); }
      else await route.continue();
    });
    await open(page);
    await page.getByRole("button", { name: retryName, exact: true }).waitFor();
    const chapter = "chapters/worms.md";
    await page.waitForFunction((chapter) => window.writer.workspace.getSnapshot().records.has(chapter), chapter);
    await page.locator(`.record-row[data-path="${chapter}"]`).click();
    await page.locator(".cm-content").focus();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type(" Chapter writing survives failed preview.");
    assert.match(await body(page, chapter), /Chapter writing survives failed preview/);
    await page.evaluate(() => { const workspace = window.writer.workspace; workspace.setBody(workspace.main, workspace.getSnapshot().records.get(workspace.main).snapshot.body + "\nWriting survives failed preview.\n"); });
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().records.get(window.writer.workspace.main).snapshot.state === "saved");
    await page.getByRole("button", { name: retryName, exact: true }).click();
    await painted(page);
    assert.match(await body(page, main), /Writing survives failed preview/);
  });

  await scenario("early bundle export waits for nested records without a preview result", async (page) => {
    await open(page); await painted(page);
    const result = await page.evaluate(async () => {
      const { backend, workspace } = window.writer;
      const one = await backend.createRecord("chapters/preflight-one.md", "# One\n\n![[preflight-two]]\n");
      const two = await backend.createRecord("chapters/preflight-two.md", "# Two\n\nNested preflight text.\n");
      const original = backend.records.open.bind(backend.records);
      backend.records.open = async (...args) => { if (args[0] === one.value || args[0] === two.value) await new Promise((resolve) => setTimeout(resolve, 300)); return original(...args); };
      await workspace.refreshCollection();
      workspace.setBody(workspace.main, "# Early export\n\n![[chapters/preflight-one]]\n");
      const out = await workspace.exportBundle();
      return { complete: new TextDecoder().decode(out.bytes).includes("Nested preflight text."), problems: out.problems };
    });
    assert.equal(result.complete, true);
    assert.deepEqual(result.problems, []);
  });

  await scenario("incomplete exports need consent before download", async (page) => {
    await open(page); await painted(page);
    let downloads = 0; page.on("download", () => downloads++);
    await page.evaluate(() => window.writer.workspace.setBody(window.writer.workspace.main, "# Incomplete\n\n![[missing-chapter]]\n"));
    await format(page, "Pandoc bundle (zip)");
    await page.getByRole("dialog", { name: "Review export problems" }).waitFor();
    assert.equal(downloads, 0);
    await page.getByRole("button", { name: "Cancel and fix problems" }).click();
    assert.equal(downloads, 0);
    await format(page, "Pandoc bundle (zip)");
    await page.getByRole("dialog", { name: "Review export problems" }).waitFor();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export anyway" }).click();
    assert.match((await downloaded).suggestedFilename(), /\.zip$/);
  });

  await scenario("failed save retains a local draft and Retry save repairs it", async (page) => {
    await open(page); await painted(page);
    const result = await page.evaluate(async () => {
      const { workspace, backend } = window.writer;
      workspace.setBody(workspace.main, "# Unsent local draft\n");
      backend.authority.failNextWrite({ problem_version: 1, code: "access_denied", category: "authorization", recovery: "reauthorize", message: "Test save failure" });
      const saved = await workspace.retrySave();
      const { DraftStore } = await import("/src/workspace/drafts.ts");
      return { failed: !saved.ok, backedUp: new DraftStore("demo").read(workspace.main)?.body === "# Unsent local draft\n" };
    });
    assert.deepEqual(result, { failed: true, backedUp: true });
    await page.getByRole("button", { name: "Retry save", exact: true }).click();
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().records.get(window.writer.workspace.main).snapshot.state === "saved");
  });

  await scenario("reloading offers review rather than overwriting with a local draft", async (page) => {
    await open(page); await painted(page);
    await page.evaluate(async () => {
      const { workspace } = window.writer;
      await workspace.retrySave();
      const snap = workspace.getSnapshot().records.get(workspace.main).snapshot;
      const { DraftStore } = await import("/src/workspace/drafts.ts");
      new DraftStore("demo").write(workspace.main, { version: 1, body: "# Recovered draft\n", frontmatter: snap.frontmatter, baseBody: snap.body, baseFrontmatter: snap.record.frontmatter, revision: snap.record.revision, updated: new Date().toISOString() });
    });
    await page.reload();
    await page.getByRole("button", { name: "Review Patient Observation", exact: true }).click();
    assert.notEqual(await body(page, main), "# Recovered draft\n");
    await page.getByRole("button", { name: "Restore local draft" }).click();
    assert.equal(await body(page, main), "# Recovered draft\n");
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().records.get(window.writer.workspace.main).snapshot.state === "saved");
  });

  await scenario("focused setting drafts are backed up before the commit delay", async (page) => {
    await open(page); await painted(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("[test] Unsent setting title");
    const backedUp = await page.evaluate(async () => { const { DraftStore } = await import("/src/workspace/drafts.ts"); return new DraftStore("demo").read(window.writer.workspace.main)?.frontmatter.title; });
    assert.equal(backedUp, "[test] Unsent setting title");
    page.on("dialog", (dialog) => dialog.accept());
    await page.reload();
    await page.getByRole("button", { name: "Review Patient Observation", exact: true }).click();
    await page.getByRole("button", { name: "Restore local draft" }).click();
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().records.get(window.writer.workspace.main).snapshot.frontmatter.title === "[test] Unsent setting title");
  });

  await scenario("leaving a conflict is guarded and merged text is saved", async (page) => {
    await page.goto(`${base}?demo`);
    await page.locator(".manuscript-row", { hasText: "Patient Observation" }).click();
    await painted(page);
    await page.evaluate(() => {
      const { workspace, backend } = window.writer;
      const snapshot = workspace.getSnapshot().records.get(workspace.main).snapshot;
      workspace.setBody(workspace.main, snapshot.body + "\nLocal conflict text.\n");
      backend.authority.editElsewhere(workspace.main, { body: snapshot.body + "\nRemote conflict text.\n" });
    });
    await page.getByRole("button", { name: "Compare versions" }).waitFor();
    await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
    await page.getByRole("dialog", { name: "Some changes are not saved" }).waitFor();
    await page.getByRole("button", { name: "Keep writing" }).click();
    await page.goBack();
    await page.getByRole("dialog", { name: "Some changes are not saved" }).waitFor();
    await page.getByRole("button", { name: "Keep writing" }).click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get("manuscript") === "manuscripts/patient-observation.md");
    await page.getByRole("button", { name: "Compare versions" }).click();
    await page.getByLabel("Merged Markdown").fill("# Merged\n\nLocal and remote changes preserved.\n");
    await page.getByRole("button", { name: "Save merged version" }).click();
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().records.get(window.writer.workspace.main).snapshot.state === "saved");
    assert.match(await body(page, main), /Local and remote changes preserved/);
  });

  await scenario("cancelling a slow Word export produces no download", async (page) => {
    await open(page); await painted(page);
    let downloads = 0; page.on("download", () => downloads++);
    await page.route("**/docx/thesis.docx", async (route) => { await new Promise((resolve) => setTimeout(resolve, 1000)); await route.continue().catch(() => {}); });
    await format(page, "Word (DOCX)");
    await page.getByRole("button", { name: "Cancel export" }).click();
    await page.waitForTimeout(1500);
    assert.equal(downloads, 0);
    assert.equal(await page.locator(".toast.tone-busy").count(), 0);
  });

  await scenario("new manuscripts can include an actionable worked example", async (page) => {
    await page.goto(`${base}?demo`);
    await page.getByRole("button", { name: "New manuscript" }).click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("[test] Worked example");
    await page.getByRole("checkbox", { name: /Include a worked example/ }).check();
    await page.getByRole("button", { name: "Create manuscript", exact: true }).click();
    await page.waitForFunction(() => window.writer?.workspace?.getSnapshot().phase === "ready");
    const text = await page.evaluate(() => { const workspace = window.writer.workspace; return workspace.getSnapshot().records.get(workspace.main).snapshot.body; });
    assert.match(text, /fig-example/); assert.match(text, /Add chapter/); assert.match(text, /A cited claim \[@/);
  });
} finally { await browser.close(); }
process.exitCode = failures ? 1 : 0;
