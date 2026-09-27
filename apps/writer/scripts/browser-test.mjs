// End-to-end test of the writer in demo mode, in headless Chromium.
// Usage: node scripts/browser-test.mjs [base URL]   (start `pnpm dev` first)
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5320/";
const executablePath = process.env.CHROME ?? "/home/calluma/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell";
mkdirSync("out", { recursive: true });

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text());
});

const results = [];
async function step(name, fn) {
  const t = performance.now();
  try {
    await fn();
    results.push(`ok    ${name} (${Math.round(performance.now() - t)} ms)`);
    console.log(results.at(-1));
  } catch (e) {
    results.push(`FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`);
    console.log(results.at(-1).slice(0, 400));
    await page.screenshot({ path: `out/fail-${name.replace(/\W+/g, "-")}.png` });
  }
}

const snapshot = () => page.evaluate(() => {
  const s = window.writer?.workspace?.getSnapshot();
  if (!s) return null;
  return {
    phase: s.phase,
    compiling: s.compiling,
    revision: s.result?.revision ?? 0,
    order: s.result?.order ?? [],
    diagnostics: (s.result?.diagnostics ?? []).map((d) => `${d.record}: ${d.message}`),
    states: Object.fromEntries([...s.records].map(([p, r]) => [p, r.snapshot.state])),
    pages: document.querySelectorAll(".preview-pages canvas.page").length,
  };
});
const waitFor = (predicate, arg, timeout = 30_000) => page.waitForFunction(predicate, arg, { timeout });
// A revision counts once its preview is on screen, not just compiled.
const waitForRevisionAfter = (revision) =>
  waitFor((r) => {
    const s = window.writer?.workspace?.getSnapshot();
    const shown = Number(document.querySelector(".preview-pages")?.dataset.renderedRevision ?? 0);
    return (s?.result?.revision ?? 0) > r && !s.compiling && shown === s.artifactRevision;
  }, revision);
// Pixels of the drawn page(s) showing `record`; scrolls that page into view first.
const previewFingerprint = (record) => page.evaluate(async (rec) => {
  const s = window.writer.workspace.getSnapshot();
  // The record's first paragraph (its first block may be a heading at a page break).
  const mine = (s.result?.positions ?? []).filter((x) => x.record === rec);
  const p = (mine[1] ?? mine[0])?.page ?? 1;
  const canvas = document.querySelector(`.preview-pages canvas[data-page="${p - 1}"]`);
  canvas?.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 400));
  const url = canvas?.toDataURL() ?? "";
  let h = 0;
  for (let i = 0; i < url.length; i += 7) h = (h * 31 + url.charCodeAt(i)) | 0;
  return `${url.length}:${h}`;
}, record);
const editorText = () => page.evaluate(() => document.querySelector(".cm-content")?.textContent ?? "");

async function typeAtEndOfParagraph(needle, text) {
  // Place the cursor right after `needle` in the editor, then type like a person.
  const line = page.locator(".cm-line", { hasText: needle }).first();
  await line.click();
  await page.keyboard.press("End");
  await page.keyboard.type(text, { delay: 25 });
}

await step("home lists the demo manuscripts", async () => {
  await page.goto(`${base}?demo`);
  await page.getByRole("heading", { name: "Manuscripts" }).waitFor();
  const titles = await page.locator(".manuscript-title").allTextContents();
  assert.deepEqual(titles, ["Potentiality and the Event: Agamben and Badiou on the Limits of the Possible", "Refusing the Possible"]);
});

await step("an existing note becomes a manuscript, keeping its type and fields", async () => {
  await page.locator(".adopt-note input").fill("drafts/on-inoperativity.md");
  await page.getByRole("button", { name: "Use as manuscript" }).click();
  await page.locator(".subbar-title", { hasText: "On inoperativity" }).waitFor();
  await waitFor(() => document.querySelectorAll(".preview-pages canvas.page").length > 0, null);
  const fm = await page.evaluate(() => window.writer.workspace.getSnapshot().records.get("drafts/on-inoperativity.md").snapshot.frontmatter);
  assert.deepEqual(fm.type, ["note", "writer-manuscript"]);
  assert.deepEqual(fm.tags, ["draft"]);
  assert.equal(fm.title, "On inoperativity");
  await page.getByRole("button", { name: "← Manuscripts" }).click();
  const titles = await page.locator(".manuscript-title").allTextContents();
  assert.ok(titles.includes("On inoperativity"), titles.join(", "));
});

await step("opening a paper typesets it with no problems", async () => {
  await page.locator(".manuscript-row", { hasText: "Potentiality and the Event" }).click();
  await waitFor(() => document.querySelectorAll(".preview-pages canvas.page").length > 0, null);
  const s = await snapshot();
  assert.ok(s.pages >= 4, `expected at least 4 pages, got ${s.pages}`);
  assert.deepEqual(s.diagnostics, []);
  await page.screenshot({ path: "out/e2e-paper.png" });
});

let keystrokeMs = 0;
await step("typing autosaves and updates the preview", async () => {
  const before = (await snapshot()).revision;
  const shownBefore = await previewFingerprint("manuscripts/potentiality.md");
  const started = Date.now();
  await typeAtEndOfParagraph("which it occurs", " Indeed.");
  await waitForRevisionAfter(before);
  keystrokeMs = Date.now() - started;
  assert.notEqual(await previewFingerprint("manuscripts/potentiality.md"), shownBefore, "the preview did not change");
  await waitFor(() => Object.values(Object.fromEntries([...window.writer.workspace.getSnapshot().records].map(([p, r]) => [p, r.snapshot.state]))).every((s) => s === "saved"), null, 10_000);
  const saved = await page.evaluate(() => window.writer.backend.authority.writes.at(-1)?.body ?? window.writer.backend.authority.writes.at(-1));
  assert.match(JSON.stringify(saved), /Indeed\./);
});

await step("citekey completion offers library sources", async () => {
  await typeAtEndOfParagraph("which it occurs", " See [@badiouEth");
  await page.locator(".cm-tooltip-autocomplete").waitFor({ timeout: 5_000 });
  const options = await page.locator(".cm-tooltip-autocomplete li").allTextContents();
  assert.ok(options.some((o) => o.includes("badiouEthics01")), `options were: ${options.slice(0, 5).join(" | ")}`);
  await page.waitForTimeout(250); // read the list, as a person would
  await page.keyboard.press("Enter");
  await page.keyboard.type("].");
  assert.match(await editorText(), /See \[@badiouEthics01\]\./);
});

await step("an unknown citekey is reported in Problems and in the editor", async () => {
  const before = (await snapshot()).revision;
  await typeAtEndOfParagraph("which it occurs", " Also [@nosuchsource2020].");
  await waitForRevisionAfter(before);
  const s = await snapshot();
  assert.ok(s.diagnostics.some((d) => d.includes("No source in the library has the citekey nosuchsource2020")), s.diagnostics.join("\n"));
  await page.locator(".problem-row", { hasText: "nosuchsource2020" }).waitFor();
  await page.locator(".cm-lintRange-error").first().waitFor({ timeout: 5_000 });
});

await step("clicking the preview moves the editor to that block", async () => {
  const target = await page.evaluate(async () => {
    const canvas = document.querySelectorAll(".preview-pages canvas.page")[1];
    canvas.scrollIntoView({ block: "center" });
    await new Promise((r) => setTimeout(r, 300));
    const r = canvas.getBoundingClientRect();
    return { x: r.left + r.width * 0.3, y: r.top + r.height * 0.4 };
  });
  await page.mouse.click(target.x, target.y);
  await page.waitForTimeout(300);
  const line = await page.evaluate(() => {
    const sel = document.getSelection();
    return sel?.anchorNode?.parentElement?.closest(".cm-line")?.textContent ?? "";
  });
  assert.ok(line.length > 10, `cursor landed on "${line}"`);
});

await step("a thesis follows embedded chapter records", async () => {
  await page.getByRole("button", { name: "← Manuscripts" }).click();
  await page.locator(".manuscript-row", { hasText: "Refusing the Possible" }).click();
  await waitFor(() => (window.writer?.workspace?.getSnapshot().result?.order.length ?? 0) === 3 && document.querySelectorAll(".preview-pages canvas.page").length >= 4, null, 60_000);
  const s = await snapshot();
  assert.deepEqual(s.order, ["manuscripts/refusing-the-possible.md", "chapters/potentiality.md", "chapters/event.md"]);
  assert.deepEqual(s.diagnostics, []);
  const rows = await page.locator(".record-name").allTextContents();
  assert.deepEqual(rows, ["Refusing the Possible", "Potentiality", "The event"]);
  await page.screenshot({ path: "out/e2e-thesis.png" });
});

await step("editing a chapter re-typesets the whole manuscript", async () => {
  await page.locator(".record-row", { hasText: "The event" }).click();
  await page.locator(".pane-path", { hasText: "chapters/event.md" }).waitFor();
  const before = (await snapshot()).revision;
  const shownBefore = await previewFingerprint("chapters/event.md");
  await typeAtEndOfParagraph("For Badiou the event", " (as a matter of ontology)");
  await waitForRevisionAfter(before);
  assert.deepEqual((await snapshot()).diagnostics, []);
  assert.notEqual(await previewFingerprint("chapters/event.md"), shownBefore, "the preview did not change");
});

await step("an edit made elsewhere during typing becomes a resolvable conflict", async () => {
  await typeAtEndOfParagraph("For Badiou the event", " Mine.");
  await page.evaluate(() => {
    const a = window.writer.backend.authority;
    const current = window.writer.workspace.getSnapshot().records.get("chapters/event.md").snapshot.record;
    a.editElsewhere("chapters/event.md", { body: current.body.replace("# The event", "# The event (theirs)") });
  });
  await page.getByText("This record changed elsewhere").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Keep mine" }).click();
  await waitFor(() => window.writer.workspace.getSnapshot().records.get("chapters/event.md").snapshot.state === "saved", null, 10_000);
  assert.match(await editorText(), /Mine\./);
});

await step("Export PDF downloads a PDF", async () => {
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("button", { name: "Export PDF" }).click(),
  ]);
  const path = `out/${file.suggestedFilename()}`;
  await file.saveAs(path);
  const { readFileSync } = await import("node:fs");
  assert.equal(readFileSync(path).subarray(0, 5).toString(), "%PDF-");
});

await step("Export for Word downloads a Pandoc bundle", async () => {
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("button", { name: "Export for Word" }).click(),
  ]);
  const path = `out/${file.suggestedFilename()}`;
  await file.saveAs(path);
  const { execFileSync } = await import("node:child_process");
  const listing = execFileSync("unzip", ["-l", path], { encoding: "utf8" });
  for (const name of ["manuscript.md", "references.json", "style.csl", "README.md"]) assert.match(listing, new RegExp(name.replace(".", "\\.")));
  const md = execFileSync("unzip", ["-p", path, "manuscript.md"], { encoding: "utf8" });
  assert.match(md, /# Potentiality \{#sec-potentiality\}/);
  assert.match(md, /# The event \(theirs\)|# The event/);
});

await step("the phone layout switches between write, preview and outline", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.locator(".preview-pane").waitFor({ state: "visible" });
  assert.equal(await page.locator(".write").isVisible(), false);
  await page.screenshot({ path: "out/e2e-mobile-preview.png" });
  await page.getByRole("button", { name: "Outline", exact: true }).click();
  await page.locator(".outline").waitFor({ state: "visible" });
  await page.screenshot({ path: "out/e2e-mobile-outline.png" });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `page scrolls horizontally by ${overflow}px`);
});

await browser.close();
console.log(`keystroke → typeset preview (first edit, with autosave running): ${keystrokeMs} ms`);
if (errors.length) console.log(`page errors:\n  ${errors.slice(0, 10).join("\n  ")}`);
process.exitCode = results.some((r) => r.startsWith("FAIL")) || errors.length ? 1 : 0;
