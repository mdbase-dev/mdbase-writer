// End-to-end test of the writer in demo mode, in headless Chromium.
// Usage: node scripts/browser-test.mjs [base URL]   (start `pnpm dev` first)
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";

import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5320/";
const executablePath = process.env.CHROME;
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
const exportAs = async (format) => {
  await page.locator(".toast.tone-busy").waitFor({ state: "detached", timeout: 120_000 });
  await page.getByRole("button", { name: "Export formats" }).click();
  await page.getByRole("menuitem", { name: format }).click();
};
// The text of the record in the editor, from its session: the editor's DOM
// holds only the lines near the view, so it changes as the editor scrolls.
const editorText = () =>
  page.evaluate(() => {
    const path = document.querySelector(".cm-content")?.getAttribute("aria-label")?.replace(/^Markdown for /, "");
    return (path && window.writer.workspace.getSnapshot().records.get(path)?.snapshot.body) ?? "";
  });

async function typeAtEndOfParagraph(needle, text) {
  // Click at the end of the line holding `needle`, then type like a person. The click goes to
  // its last wrapped row: End alone only reaches the end of the row that was clicked.
  const line = page.locator(".cm-line", { hasText: needle }).first();
  await line.scrollIntoViewIfNeeded();
  const end = await line.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    const last = [...range.getClientRects()].filter((r) => r.width > 0).at(-1);
    return { x: last.right - 1, y: last.top + last.height / 2 };
  });
  await page.mouse.click(end.x, end.y);
  await page.keyboard.press("End");
  await page.keyboard.type(text, { delay: 25 });
}

await step("home lists the demo manuscripts", async () => {
  await page.goto(`${base}?demo`);
  await page.getByRole("heading", { name: "Manuscripts" }).waitFor();
  const titles = await page.locator(".manuscript-title").allTextContents();
  assert.deepEqual(titles, ["Patient Observation", "Small Agents, Large Effects: Darwin and the Science of Slow Change"]);
});

await step("an existing note becomes a manuscript, keeping its type and fields", async () => {
  await page.getByRole("button", { name: "New manuscript" }).click();
  await page.getByRole("button", { name: "Use a note you already have…" }).click();
  await page.locator(".adopt-note input").fill("worm stones");
  await page.locator(".note-option", { hasText: "On worm stones" }).click();
  await page.getByRole("button", { name: "Use as manuscript" }).click();
  await page.locator(".bar-title", { hasText: "On worm stones" }).waitFor();
  await waitFor(() => document.querySelectorAll(".preview-pages canvas.page").length > 0, null);
  const fm = await page.evaluate(() => window.writer.workspace.getSnapshot().records.get("drafts/on-worm-stones.md").snapshot.frontmatter);
  assert.deepEqual(fm.type, ["note", "writer-manuscript"]);
  assert.deepEqual(fm.tags, ["draft"]);
  assert.equal(fm.title, "On worm stones");
  await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
  const titles = await page.locator(".manuscript-title").allTextContents();
  assert.ok(titles.includes("On worm stones"), titles.join(", "));
});

await step("opening a paper typesets it with no problems", async () => {
  await page.locator(".manuscript-row", { hasText: "Small Agents, Large Effects" }).click();
  await waitFor(() => document.querySelectorAll(".preview-pages canvas.page").length > 0, null);
  const s = await snapshot();
  assert.ok(s.pages >= 3, `expected at least 3 pages, got ${s.pages}`);
  assert.deepEqual(s.diagnostics, []);
  await page.screenshot({ path: "out/e2e-paper.png" });
});

let keystrokeMs = 0;
await step("typing autosaves and updates the preview", async () => {
  const before = (await snapshot()).revision;
  const shownBefore = await previewFingerprint("manuscripts/slow-change.md");
  const started = Date.now();
  await typeAtEndOfParagraph("causes now in operation", " Indeed.");
  await waitForRevisionAfter(before);
  keystrokeMs = Date.now() - started;
  assert.notEqual(await previewFingerprint("manuscripts/slow-change.md"), shownBefore, "the preview did not change");
  await waitFor(() => Object.values(Object.fromEntries([...window.writer.workspace.getSnapshot().records].map(([p, r]) => [p, r.snapshot.state]))).every((s) => s === "saved"), null, 10_000);
  const saved = await page.evaluate(() => window.writer.backend.authority.writes.at(-1)?.body ?? window.writer.backend.authority.writes.at(-1));
  assert.match(JSON.stringify(saved), /Indeed\./);
});

await step("citekey completion offers library sources", async () => {
  await typeAtEndOfParagraph("causes now in operation", " See [@darwinForm");
  await page.locator(".cm-tooltip-autocomplete").waitFor({ timeout: 5_000 });
  const options = await page.locator(".cm-tooltip-autocomplete li").allTextContents();
  assert.ok(options.some((o) => o.includes("darwinFormation81")), `options were: ${options.slice(0, 5).join(" | ")}`);
  await page.waitForTimeout(250); // read the list, as a person would
  await page.keyboard.press("Enter");
  await page.keyboard.type("].");
  assert.match(await editorText(), /See \[@darwinFormation81\]\./);
});

await step("citekey completion finds sources by title words", async () => {
  await typeAtEndOfParagraph("causes now in operation", " Compare [@selborne");
  await page.locator(".cm-tooltip-autocomplete").waitFor({ timeout: 5_000 });
  const options = await page.locator(".cm-tooltip-autocomplete li").allTextContents();
  assert.ok(options[0]?.includes("whiteNatural89"), `options were: ${options.slice(0, 5).join(" | ")}`);
  await page.waitForTimeout(250);
  await page.keyboard.press("Enter");
  await page.keyboard.type("].");
  assert.match(await editorText(), /Compare \[@whiteNatural89\]\./);
});

await step("a Reader quotation goes in with its citation and page", async () => {
  await typeAtEndOfParagraph("causes now in operation", " ");
  await page.getByRole("tab", { name: /Sources/ }).click();
  await page.locator(".sources input[type=search]").fill("vegetable");
  await page.locator(".source-row", { hasText: "vegetable mould" }).click();
  await page.getByRole("button", { name: "Insert quotation" }).click();
  assert.match(await editorText(), /“It may be doubted whether there are many other animals which have played so important a part in the history of the world, as have these lowly organised creatures\.” \[@darwinFormation81, p\. 313\]/);
});

await step("an embedded Reader annotation shows and typesets as its quotation, and detaches", async () => {
  const main = "manuscripts/slow-change.md";
  const before = (await snapshot()).revision;
  await page.evaluate((path) => {
    const w = window.writer.workspace;
    w.setBody(path, `${w.getSnapshot().records.get(path).snapshot.body.trimEnd()}\n\n![[annotations/darwin-worms-history]]\n`);
  }, main);
  const card = page.locator(".cm-quote-card");
  // Lines out of view are not drawn.
  await waitFor(() => {
    const scroller = document.querySelector(".cm-scroller");
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    return document.querySelector(".cm-quote-card");
  }, null, 10_000);
  assert.match(await card.textContent(), /It may be doubted.*Darwin, 1881, p\. 313/);
  assert.doesNotMatch(await card.textContent(), /The closing claim the paper/);
  await waitForRevisionAfter(before);
  const s = await page.evaluate(() => {
    const r = window.writer.workspace.getSnapshot().result;
    return { diagnostics: r.diagnostics.map((d) => d.message), order: r.order, positions: r.positions.filter((p) => p.record.startsWith("annotations/")).length };
  });
  assert.deepEqual(s.diagnostics, []);
  assert.ok(!s.order.includes("annotations/darwin-worms-history.md"), "an embedded annotation is not a chapter");
  assert.equal(s.positions, 0, "the quotation's blocks map to the embed");
  assert.ok(!(await page.evaluate(() => window.writer.workspace.chapterPaths())).includes("annotations/darwin-worms-history.md"));
  await card.getByRole("button", { name: "Detach" }).click();
  assert.match(await editorText(), /> It may be doubted whether there are many other animals which have played so important a part in the history of the world, as have these lowly organised creatures\. \[@darwinFormation81, p\. 313\]/);
  assert.equal(await card.count(), 0);
  await page.evaluate(() => document.querySelector(".cm-scroller")?.scrollTo({ top: 0 }));
});

await step("a toolbar over a selection formats it and finds a source for it", async () => {
  const before = await editorText();
  const bar = page.locator(".cm-selection-bar");
  // Double-click "Charles" (hard-wrapped lines are joined), then take "Lyell" too.
  const charles = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector(".cm-content"), NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent.indexOf("Charles Lyell, who");
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + "Charles".length);
      const r = range.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  });
  assert.ok(charles, "found “Charles Lyell, who” in the editor");
  await page.mouse.dblclick(charles.x, charles.y);
  await page.keyboard.press("ControlOrMeta+Shift+ArrowRight");
  await bar.waitFor({ timeout: 5_000 });
  await bar.getByRole("button", { name: "Bold" }).click();
  assert.match(await editorText(), /\*\*Charles Lyell\*\*, who/);
  assert.ok(await bar.isVisible(), "the bar stays up after formatting");
  // Escape puts the bar away and keeps the selection; the shortcut toggles bold off again.
  await page.keyboard.press("Escape");
  await bar.waitFor({ state: "hidden", timeout: 5_000 });
  await page.keyboard.press("ControlOrMeta+b");
  assert.equal(await editorText(), before);
  await page.keyboard.press("Shift+ArrowLeft");
  await bar.getByRole("button", { name: "Cite", exact: true }).click();
  await waitFor(() => document.querySelector(".sources input[type=search]")?.value === "Charles Lyel", undefined, 5_000);
  assert.equal(await editorText(), before);
});

await step("the preview follows the cursor", async () => {
  await page.evaluate(() => (document.querySelector(".preview").scrollTop = 0));
  await page.locator(".cm-content").focus();
  await page.keyboard.press("ControlOrMeta+End");
  await page.waitForFunction(() => document.querySelector(".preview").scrollTop > 200, null, { timeout: 5_000 });
  await page.keyboard.press("ControlOrMeta+Home");
});

await step("a setting's problem opens the setting", async () => {
  const before = (await snapshot()).revision;
  await page.evaluate(() => window.writer.workspace.patchFrontmatter("manuscripts/slow-change.md", { lang: "tlh" }));
  await waitForRevisionAfter(before);
  await page.locator("button.bar-problems").click();
  await page.locator(".problem-row", { hasText: "no terms for" }).click();
  await page.locator(".settings-sheet .field-problem", { hasText: "no terms for" }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.value), "tlh");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.type("en-GB");
  await page.keyboard.press("Tab");
  await waitFor(() => window.writer.workspace.getSnapshot().result?.meta.locale === "en-GB", null, 10_000);
  await page.keyboard.press("Escape");
  await page.locator(".settings-sheet").waitFor({ state: "detached", timeout: 2_000 }).catch(() => {});
  assert.equal(await page.locator(".settings-sheet").count(), 0);
});

await step("an unknown citekey is reported in Problems and in the editor", async () => {
  const before = (await snapshot()).revision;
  await typeAtEndOfParagraph("causes now in operation", " Also [@nosuchsource2020].");
  await waitForRevisionAfter(before);
  const s = await snapshot();
  assert.ok(s.diagnostics.some((d) => d.includes("No source in the library has the citekey nosuchsource2020")), s.diagnostics.join("\n"));
  await page.locator("button.bar-problems").click();
  await page.locator(".problem-row", { hasText: "nosuchsource2020" }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".cm-lintRange-error").first().waitFor({ timeout: 5_000 });
});

await step("hovering a citation shows its bibliography entry; Mod-click on a cross-reference goes to its section", async () => {
  const at = (needle, into = 3) =>
    page.evaluate(([needle, into]) => {
      const walker = document.createTreeWalker(document.querySelector(".cm-content"), NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode;
        const i = n.textContent.indexOf(needle);
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i + into);
        r.setEnd(n, i + into + 1);
        const b = r.getBoundingClientRect();
        return { x: b.x + 2, y: b.y + b.height / 2 };
      }
      return null;
    }, [needle, into]);
  const hover = async (point) => {
    // A hover starts with the pointer arriving from outside the editor.
    await page.mouse.move(5, 5);
    await page.waitForTimeout(300);
    await page.mouse.move(point.x, point.y, { steps: 4 });
  };
  await page.getByRole("tab", { name: "Outline" }).click();
  await page.evaluate(() => document.querySelector(".cm-scroller").scrollTo(0, 0));
  await page.waitForTimeout(100);
  const cite = await at("lyellPrinciples30");
  assert.ok(cite, "citation on screen");
  await hover(cite);
  await page.locator(".cm-ref-tip", { hasText: "John Murray" }).waitFor({ timeout: 5_000 });
  assert.equal(await page.locator(".cm-ref-tip em").first().textContent(), "Principles of Geology");
  const ref = await at("@sec-worms", 4);
  await hover(ref);
  await page.locator(".cm-ref-tip", { hasText: "Earthworms: the moving surface" }).waitFor({ timeout: 5_000 });
  await page.keyboard.down("ControlOrMeta");
  await page.mouse.click(ref.x, ref.y);
  await page.keyboard.up("ControlOrMeta");
  await page.locator(".heading-row[aria-current=location]", { hasText: "Earthworms: the moving surface" }).waitFor({ timeout: 5_000 });
});

await step("F8 goes to the next problem", async () => {
  await page.locator(".cm-content").focus();
  await page.keyboard.press("ControlOrMeta+Home");
  await page.keyboard.press("F8");
  await page.waitForTimeout(200);
  const line = await page.evaluate(() => window.getSelection()?.anchorNode?.parentElement?.closest(".cm-line")?.textContent ?? "");
  assert.match(line, /nosuchsource2020/);
});

await step("the sidebar and preview can be hidden, and the layout is remembered", async () => {
  await page.getByRole("button", { name: "Sidebar" }).click();
  assert.equal(await page.locator(".outline").isVisible(), false);
  await page.getByRole("button", { name: "Editor only" }).click();
  assert.equal(await page.locator(".preview-pane").isVisible(), false);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mdbase-writer:layout")));
  assert.equal(saved.sidebar, false);
  assert.equal(saved.view, "write");
  await page.getByRole("button", { name: "Sidebar" }).click();
  await page.getByRole("button", { name: "Editor and preview" }).click();
  await page.locator(".preview-pane").waitFor({ state: "visible" });
});

await step("the sidebar resizes by dragging its edge or with the arrow keys", async () => {
  const width = () => page.evaluate(() => Math.round(document.querySelector(".outline").getBoundingClientRect().width));
  const handle = page.getByRole("separator", { name: "Resize the sidebar" });
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 300);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + 300, { steps: 5 });
  await page.mouse.up();
  assert.equal(await width(), 372);
  await handle.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await width(), 356);
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("mdbase-writer:layout")))).sidebarWidth, 356);
  await handle.dblclick();
  assert.equal(await width(), 272);
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
  await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
  await page.locator(".manuscript-row", { hasText: "Patient Observation" }).click();
  await waitFor(() => (window.writer?.workspace?.getSnapshot().result?.order.length ?? 0) === 3 && document.querySelectorAll(".preview-pages canvas.page").length >= 4, null, 60_000);
  const s = await snapshot();
  assert.deepEqual(s.order, ["manuscripts/patient-observation.md", "chapters/reefs.md", "chapters/worms.md"]);
  assert.deepEqual(s.diagnostics, []);
  const rows = await page.locator(".record-name").allTextContents();
  assert.deepEqual(rows, ["Patient Observation", "Coral reefs", "Earthworms"]);
  // The manuscript's embeds are drawn as chapter cards.
  await waitFor(() => [...document.querySelectorAll(".cm-chapter-title")].map((e) => e.textContent).join("|") === "Coral reefs|Earthworms", null);
  await page.screenshot({ path: "out/e2e-thesis.png" });
});

await step("editing a chapter re-typesets the whole manuscript", async () => {
  await page.locator(".record-row", { hasText: "Earthworms" }).click();
  await page.locator(".pane-path", { hasText: "chapters/worms.md" }).waitFor();
  const before = (await snapshot()).revision;
  const shownBefore = await previewFingerprint("chapters/worms.md");
  await typeAtEndOfParagraph("Worms swallow earth", " (by digestion)");
  await waitForRevisionAfter(before);
  assert.deepEqual((await snapshot()).diagnostics, []);
  assert.notEqual(await previewFingerprint("chapters/worms.md"), shownBefore, "the preview did not change");
});

await step("an edit made elsewhere during typing becomes a resolvable conflict", async () => {
  await typeAtEndOfParagraph("Worms swallow earth", " Mine.");
  await page.evaluate(() => {
    const a = window.writer.backend.authority;
    const current = window.writer.workspace.getSnapshot().records.get("chapters/worms.md").snapshot.record;
    a.editElsewhere("chapters/worms.md", { body: current.body.replace("# Earthworms", "# Earthworms (theirs)") });
  });
  await page.getByText("This record changed elsewhere").waitFor({ timeout: 10_000 });
  await page.getByRole("button", { name: "Keep mine" }).click();
  await waitFor(() => window.writer.workspace.getSnapshot().records.get("chapters/worms.md").snapshot.state === "saved", null, 10_000);
  assert.match(await editorText(), /Mine\./);
});

const mainBody = () => page.evaluate(() => window.writer.workspace.getSnapshot().records.get("manuscripts/patient-observation.md").snapshot.body);
const orderIs = (order) => waitFor((o) => JSON.stringify(window.writer.workspace.getSnapshot().result?.order) === JSON.stringify(o), order, 15_000);

await step("search finds text across the manuscript's records and goes to it", async () => {
  await page.keyboard.press("ControlOrMeta+Shift+F");
  const field = page.getByRole("searchbox", { name: "Search the manuscript" });
  await waitFor(() => document.activeElement?.getAttribute("aria-label") === "Search the manuscript", null, 5_000);
  await field.fill("darwin");
  await page.locator(".search-group").nth(1).waitFor({ timeout: 5_000 });
  const records = await page.locator(".search-group .sidebar-heading").allTextContents();
  assert.ok(records.length >= 2 && records.some((r) => r.startsWith("Earthworms")), records.join(" | "));
  assert.equal(await page.locator(".outline-panel").count(), 0, "the matches take the outline's place");
  // Enter steps from the field, which keeps focus; a click goes to a match and into the editor.
  await field.press("Enter");
  await page.locator('.search-hit[aria-current="true"]').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Search the manuscript");
  await page.locator(".search-group", { hasText: "Earthworms" }).locator(".search-hit").first().click();
  await page.locator(".pane-title", { hasText: "Earthworms" }).waitFor({ timeout: 5_000 });
  await waitFor(() => window.getSelection()?.toString().toLowerCase() === "darwin", null, 5_000);
  // Escape in the field clears it, and the outline comes back.
  await field.press("Escape");
  await page.locator(".outline-panel").waitFor();
});

await step("the outline numbers chapters without repeating their titles", async () => {
  await page.getByRole("tab", { name: "Outline" }).click();
  assert.deepEqual(await page.locator(".record-number").allTextContents(), ["1", "2"]);
  // Each chapter opens with a heading that is its title; the outline does not list it again.
  assert.equal(await page.locator(".records .heading-row", { hasText: /^Coral reefs/ }).count(), 0);
  assert.match(await page.locator(".outline-manuscript .record-words").textContent(), /words/);
});

await step("chapters reorder with Alt-arrow keys and by dragging", async () => {
  await page.locator('.record-row[data-path="chapters/worms.md"]').focus();
  await page.keyboard.press("Alt+ArrowUp");
  await orderIs(["manuscripts/patient-observation.md", "chapters/worms.md", "chapters/reefs.md"]);
  assert.ok((await mainBody()).indexOf("chapters/worms") < (await mainBody()).indexOf("chapters/reefs"));
  await page.locator(".records > li", { hasText: "Coral reefs" }).dragTo(page.locator(".records > li", { hasText: "Earthworms" }), { targetPosition: { x: 20, y: 4 } });
  await orderIs(["manuscripts/patient-observation.md", "chapters/reefs.md", "chapters/worms.md"]);
});

await step("a new chapter is created and embedded after the last", async () => {
  await page.getByRole("button", { name: "Add chapter" }).click();
  await page.getByRole("textbox", { name: "New chapter title" }).fill("The aftermath");
  await page.keyboard.press("Enter");
  await orderIs(["manuscripts/patient-observation.md", "chapters/reefs.md", "chapters/worms.md", "chapters/the-aftermath.md"]);
  await page.locator(".pane-path", { hasText: "chapters/the-aftermath.md" }).waitFor();
  assert.match(await mainBody(), /!\[\[chapters\/worms\]\]\n\n!\[\[chapters\/the-aftermath\]\]/);
  assert.deepEqual(await page.locator(".record-number").allTextContents(), ["1", "2", "3"]);
});

await step("sources list the manuscript's citations first, and cite with a page", async () => {
  await page.getByRole("tab", { name: /Sources/ }).click();
  const cited = page.locator(".source-group", { has: page.getByRole("heading", { name: /In this manuscript/ }) });
  const titles = await cited.locator(".source-title").allTextContents();
  assert.equal(titles.length, 4, `cited: ${titles.join(" | ")}`);
  assert.match(titles[0] ?? "", /coral reefs/);
  await typeAtEndOfParagraph("The aftermath", "");
  await page.keyboard.press("End");
  await page.keyboard.type("\n\nAs argued ");
  await cited.locator(".source-row", { hasText: "vegetable mould" }).click();
  await page.getByRole("textbox", { name: /Page or locator/ }).fill("23-24");
  await page.getByRole("textbox", { name: /Page or locator/ }).press("Enter");
  assert.match(await editorText(), /As argued \[@darwinFormation81, p\. 23-24\]/);
});

await step("a source steps through its citations, and the one at the cursor is marked", async () => {
  // The cursor is after the citation just made (the workspace hears of cursor moves after a pause).
  await page.waitForTimeout(250);
  await page.locator(".source-row", { hasText: "vegetable mould" }).focus();
  await page.getByRole("button", { name: "Next citation" }).click();
  await page.locator(".pane-path", { hasText: "chapters/worms.md" }).waitFor();
  await page.locator(".sources li.is-here", { hasText: "vegetable mould" }).waitFor({ timeout: 5_000 });
});

await step("the sources list moves with the arrow keys and cites with Enter", async () => {
  await page.getByRole("searchbox", { name: "Find a source" }).fill("");
  await page.getByRole("searchbox", { name: "Find a source" }).press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.key), "darwinStructure42");
  await page.keyboard.press("ArrowDown");
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.key), "lyellPrinciples30");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await page.locator(".cm-content", { hasText: "[@darwinStructure42]" }).first().waitFor({ timeout: 5_000 });
});

/** Moves the pointer down page `n` (1-based) until the preview offers to show a source there, and clicks. */
async function clickSourceInPreview(n, from = 0) {
  const canvas = page.locator(`.preview-pages canvas[data-page="${n - 1}"]`);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  for (let y = box.y + from * box.height; y < box.y + box.height; y += 4) {
    await page.mouse.move(box.x + box.width / 2, y);
    if ((await canvas.getAttribute("title")) === "Show in Sources") {
      await page.mouse.click(box.x + box.width / 2, y);
      return;
    }
  }
  throw new Error(`nothing on page ${n} offers to show a source`);
}

await step("a bibliography entry or citation note in the preview shows its source", async () => {
  await page.getByRole("tab", { name: "Outline" }).click();
  const marks = await page.evaluate(() => window.writer.workspace.getSnapshot().result.marks);
  const entry = marks.find((m) => m.kind === "entry");
  const note = marks.find((m) => m.kind === "note" && m.record === "chapters/reefs.md");
  assert.ok(entry && note, `marks: ${JSON.stringify(marks).slice(0, 300)}`);
  // The first bibliography entry: its source opens in Sources.
  await clickSourceInPreview(entry.page);
  await page.locator(`.sources li.is-open .source-row[data-key="${entry.keys[0]}"]`).waitFor({ timeout: 5_000 });
  // A citation note: its source opens, and the editor goes to the citation.
  await page.getByRole("tab", { name: "Outline" }).click();
  await clickSourceInPreview(note.page, 0.5);
  await page.locator(".sources li.is-open .source-row").waitFor({ timeout: 5_000 });
  await page.locator(".pane-path", { hasText: "chapters/reefs.md" }).waitFor({ timeout: 5_000 });
});

await step("Export PDF downloads a PDF", async () => {
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    exportAs("PDF"),
  ]);
  const path = `out/${file.suggestedFilename()}`;
  await file.saveAs(path);
  const { readFileSync } = await import("node:fs");
  assert.equal(readFileSync(path).subarray(0, 5).toString(), "%PDF-");
});

await step("Export Word downloads a DOCX made by Pandoc in the browser", async () => {
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 120_000 }),
    exportAs("Word (DOCX)"),
  ]);
  const path = `out/${file.suggestedFilename()}`;
  await file.saveAs(path);
  const { execFileSync } = await import("node:child_process");
  const text = execFileSync("pandoc", [path, "-t", "plain"], { encoding: "utf8" });
  assert.match(text, /Patient Observation|Coral reefs/);
  assert.doesNotMatch(text, /\((sec|fig|tbl|eq)-[\w-]+\?\)/);
});

await step("the Pandoc bundle downloads a zip", async () => {
  const [file] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    exportAs("Pandoc bundle (zip)"),
  ]);
  const path = `out/${file.suggestedFilename()}`;
  await file.saveAs(path);
  const { execFileSync } = await import("node:child_process");
  const listing = execFileSync("unzip", ["-l", path], { encoding: "utf8" });
  for (const name of ["manuscript.md", "references.json", "style.csl", "README.md"]) assert.match(listing, new RegExp(name.replace(".", "\\.")));
  const md = execFileSync("unzip", ["-p", path, "manuscript.md"], { encoding: "utf8" });
  assert.match(md, /# Coral reefs \{#sec-reefs\}/);
  assert.match(md, /# Earthworms \(theirs\)|# Earthworms/);
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
