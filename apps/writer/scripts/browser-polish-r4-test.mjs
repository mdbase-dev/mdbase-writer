import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import axe from "axe-core";

const base = process.env.BASE ?? "http://127.0.0.1:5320/";
const origin = new URL(base).origin;
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
mkdirSync("out/polish-r4", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const results = [];
const rules = ["landmark-one-main", "heading-order", "landmark-unique", "aria-allowed-role", "region"];

async function semantics(page) {
  await page.evaluate(axe.source);
  const violations = await page.evaluate(async rules => (await window.axe.run(document, { runOnly: rules })).violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) })), rules);
  assert.deepEqual(violations, []);
  assert.equal(await page.getByRole("main").count(), 1);
}

async function touchTargets(page, selector) {
  const targets = await page.locator(selector).evaluateAll(elements => elements.map(element => ({ label: element.getAttribute("aria-label") ?? element.textContent, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
  assert.ok(targets.every(target => target.width >= 44 && target.height >= 44), JSON.stringify(targets));
}

async function typeInEditor(page, text) {
  await page.waitForFunction(() => window.writer.workspace.getSnapshot().phase === "ready");
  await page.waitForFunction(() => document.activeElement?.matches(".cm-content[contenteditable=true]"));
  await page.keyboard.type(text);
  assert.ok(await page.evaluate(text => [...window.writer.workspace.getSnapshot().records.values()].some(record => record.snapshot.body.includes(text)), text), `Typing after handoff lost ${text}`);
}

async function command(page, query) {
  await page.keyboard.press("Control+k");
  await page.locator(".mdbase-command-palette input").waitFor();
  await page.waitForFunction(() => document.activeElement?.matches(".mdbase-command-palette input"));
  await page.keyboard.type(query);
  assert.equal(await page.locator(".mdbase-command-palette input").inputValue(), query);
  await page.keyboard.press("Enter");
  await page.locator(".mdbase-command-backdrop").waitFor({ state: "detached" });
}

async function pressFill(page, locator) {
  await page.waitForFunction(() => !document.querySelector(".sync-status"));
  await locator.hover();
  await page.waitForTimeout(130);
  const before = await locator.evaluate(element => getComputedStyle(element).backgroundColor);
  await page.mouse.down();
  await page.waitForTimeout(70);
  const during = await locator.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, active: element.matches(":active"), label: element.id || element.className }));
  await locator.evaluate(element => element.addEventListener("click", event => { event.preventDefault(); event.stopImmediatePropagation(); }, { capture: true, once: true }));
  await page.mouse.up();
  assert.equal(during.active, true, `Pointer did not press ${JSON.stringify(during)}`);
  assert.notEqual(during.background, before, `Press fill missing: ${JSON.stringify({ before, during })}`);
  await locator.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
}

async function continuePosition(page, width, reduced) {
  const editor = page.locator(".cm-content");
  await editor.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText(`# Retained manuscript\n\n${Array.from({ length: 200 }, (_, index) => `Paragraph ${index}: ${"A sentence with several words. ".repeat(10)}`).join("\n\n")}\n`);
  await page.keyboard.press("Control+End");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.type(" POSITION_MARK ");
  await page.keyboard.press("ArrowLeft");
  await page.waitForFunction(() => { const snapshot = window.writer.workspace.getSnapshot(); return [...snapshot.records.values()].every(record => record.snapshot.state === "saved") && !snapshot.compiling; }, null, { timeout: 60000 });
  if (width === 390) await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.waitForFunction(() => { const snapshot = window.writer.workspace.getSnapshot(); return Number(document.querySelector(".preview-pages")?.dataset.renderedRevision) === snapshot.artifactRevision; }, null, { timeout: 60000 });
  if (width === 390) await page.getByRole("button", { name: "Write", exact: true }).click();
  const visible = () => page.locator(".cm-scroller").evaluate(element => {
    const top = element.getBoundingClientRect().top;
    const line = [...element.querySelectorAll(".cm-line")].find(line => line.textContent && line.getBoundingClientRect().bottom > top);
    return { text: line.textContent, y: line.getBoundingClientRect().top - top, width: element.clientWidth, height: element.clientHeight, scroll: element.scrollTop };
  });
  const anchor = await visible();
  assert.ok(await page.locator(".cm-scroller").evaluate(element => element.scrollTop > 1000));
  if (width === 1440) {
    await pressFill(page, page.locator(".segmented button").first());
    const bitmaps = await page.locator(".preview canvas").evaluateAll(elements => elements.map(element => element.width).join(","));
    await page.evaluate(() => {
      window.paneLongTasks = [];
      window.paneTaskObserver = new PerformanceObserver(list => window.paneLongTasks.push(...list.getEntries().map(entry => entry.duration)));
      window.paneTaskObserver.observe({ type: "longtask" });
    });
    await page.evaluate(() => { window.paneFrames = []; window.paneRunning = true; const sample = () => { const element = document.querySelector(".write"); window.paneFrames.push({ opacity: Number(getComputedStyle(element).opacity), transform: getComputedStyle(element).transform, columns: getComputedStyle(document.querySelector(".workspace")).gridTemplateColumns, running: element.getAnimations().some(animation => animation.playState === "running" || animation.pending), bitmaps: [...document.querySelectorAll(".preview canvas")].map(element => element.width).join(",") }); if (window.paneRunning) requestAnimationFrame(sample); }; requestAnimationFrame(sample); });
    await page.keyboard.press("Control+Backslash");
    if (!reduced) {
      await page.waitForFunction(() => window.paneFrames.some(frame => frame.opacity < 1));
      await page.locator(".write").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    }
    await page.waitForTimeout(190);
    const frames = await page.evaluate(() => { window.paneRunning = false; return window.paneFrames; });
    const tasks = await page.evaluate(() => { window.paneTaskObserver.disconnect(); return window.paneLongTasks; });
    assert.ok(tasks.every(duration => duration < 50), `Sidebar long-task budget exceeded: ${JSON.stringify(tasks)}`);
    assert.ok(frames.every(frame => frame.opacity > 0));
    assert.equal(await page.locator(".preview-pane").evaluate(element => getComputedStyle(element).opacity === "1" && element.getAnimations().length === 0), true, "Pane moves must leave the preview undimmed");
    if (!reduced) assert.ok(new Set(frames.map(frame => frame.opacity)).size >= 3, `10k-word pane move is not visibly animated: ${JSON.stringify(frames)}`);
    else assert.ok(frames.every(frame => frame.transform === "none"));
    await page.keyboard.press("Control+Backslash");
    await page.waitForTimeout(190);
  }
  await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
  await page.locator(".continue-card").waitFor();
  assert.equal(await page.locator(".continue-card").count(), 1);
  const position = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(key => key.startsWith("mdbase-writer:recent:"))))[0].position);
  assert.ok(position.head > 10000 && position.top > 0, JSON.stringify(position));
  await page.locator(".continue-card").getByRole("button", { name: /^Continue/, exact: false }).click();
  await editor.waitFor();
  await page.waitForTimeout(220);
  const restored = await visible();
  assert.equal(restored.text, anchor.text);
  assert.ok(Math.abs(restored.y - anchor.y) < 2, `Continue moved visible text: ${JSON.stringify({ anchor, restored, position })}`);
  const before = await page.evaluate(() => { const workspace = window.writer.workspace; return workspace.getSnapshot().records.get(workspace.main).snapshot.body; });
  await page.keyboard.type("RESUMED");
  assert.equal(await page.evaluate(() => { const workspace = window.writer.workspace; return workspace.getSnapshot().records.get(workspace.main).snapshot.body; }), before.slice(0, position.head) + "RESUMED" + before.slice(position.head));
  if (width === 390) await page.locator(".pane-tabs button").first().click();
  await page.getByRole("tablist", { name: "Sidebar", exact: true }).getByRole("tab", { name: /^Sources/ }).click();
  await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
  await page.locator('.home [data-path][data-path="manuscripts/patient-observation.md"]').click();
  await page.locator(".cm-content").waitFor();
  await page.reload();
  await page.locator(".workspace").waitFor();
  assert.equal(await page.locator("#sidebar-tab-sources").getAttribute("aria-selected"), "true");
}

async function immediateResume(page, shortcut, overlay, text, reduced) {
  await page.locator(".cm-content").focus();
  await page.keyboard.press(shortcut);
  await page.locator(overlay).waitFor();
  await page.evaluate(({ overlay }) => {
    window.resumeKeys = [];
    const record = event => {
      if (event.key.length !== 1) return;
      const element = document.querySelector(overlay);
      window.resumeKeys.push({ key: event.key, editor: event.target.matches(".cm-content"), attached: Boolean(element), inert: element?.inert });
      if (window.resumeKeys.length === 1) document.removeEventListener("keydown", record, true);
    };
    document.addEventListener("keydown", record, true);
  }, { overlay });
  await page.keyboard.press("Escape");
  await page.keyboard.type(text, { delay: 3 });
  assert.ok(await page.evaluate(text => [...window.writer.workspace.getSnapshot().records.values()].some(record => record.snapshot.body.includes(text)), text), `Immediate Escape resume lost ${text}`);
  const [first] = await page.evaluate(() => window.resumeKeys);
  assert.equal(first.editor, true, JSON.stringify(first));
  if (!reduced) assert.deepEqual({ attached: first.attached, inert: first.inert }, { attached: true, inert: true });
  await page.locator(overlay).waitFor({ state: "hidden" });
}

async function roundFive(page, width, reduced) {
  for (const [shortcut, selector, text] of [["Control+k", ".mdbase-command-backdrop", " PALETTE_POINTER "], ["Control+/", ".shortcuts-dialog", " HELP_POINTER "]]) {
    await page.locator(".cm-content").focus();
    await page.keyboard.press(shortcut);
    await page.locator(selector).waitFor();
    await page.mouse.click(4, 10);
    await page.keyboard.type(text, { delay: 3 });
    assert.ok(await page.evaluate(text => [...window.writer.workspace.getSnapshot().records.values()].some(record => record.snapshot.body.includes(text)), text), `Pointer dismissal lost ${text}`);
    assert.equal(await page.evaluate(() => document.activeElement?.matches(".cm-content")), true);
    await page.locator(selector).waitFor({ state: "hidden" });
  }
  await immediateResume(page, "Control+k", ".mdbase-command-backdrop", " PALETTE_ESCAPE ", reduced);
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Settings");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  await page.waitForFunction(() => document.activeElement?.matches(".mdbase-command-palette input"));
  assert.equal(await page.locator(".mdbase-command-palette input").inputValue(), "");
  await page.keyboard.press("Escape");
  await page.locator(".mdbase-command-backdrop").waitFor({ state: "hidden" });
  await immediateResume(page, "Control+/", ".shortcuts-dialog", " HELP_ESCAPE ", reduced);
  await command(page, "Keyboard shortcuts");
  await page.locator(".shortcuts-dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.type(" PALETTE_HELP ", { delay: 3 });
  assert.ok(await page.evaluate(() => [...window.writer.workspace.getSnapshot().records.values()].some(record => record.snapshot.body.includes(" PALETTE_HELP "))));
  await page.locator(".shortcuts-dialog").waitFor({ state: "hidden" });
  await command(page, "Settings");
  await page.locator(".settings-sheet").waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.type(" PALETTE_SETTINGS ", { delay: 3 });
  assert.ok(await page.evaluate(() => [...window.writer.workspace.getSnapshot().records.values()].some(record => record.snapshot.body.includes(" PALETTE_SETTINGS "))));
  await page.locator(".settings-sheet").waitFor({ state: "detached" });
  await page.evaluate(() => {
    window.backdropFrames = [];
    window.backdropRunning = true;
    const sample = () => {
      const dialog = document.querySelector(".shortcuts-dialog");
      if (dialog) window.backdropFrames.push({ open: dialog.open, opacity: Number(getComputedStyle(dialog, "::backdrop").opacity), animations: dialog.getAnimations({ subtree: true }).filter(animation => animation.effect?.pseudoElement === "::backdrop").map(animation => ({ duration: animation.effect.getTiming().duration, easing: animation.effect.getTiming().easing })) });
      if (window.backdropRunning) requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  await page.keyboard.press("Control+/");
  const help = page.locator(".shortcuts-dialog");
  await help.waitFor();
  assert.ok(await help.locator(".shortcut-group").count() >= 6);
  for (const label of ["Cycle editor and preview", "Choose export format", "Previous problem", "Find and replace", "Select next occurrence", "Move the focused chapter up"]) assert.match(await help.innerText(), new RegExp(label));
  await page.waitForTimeout(190);
  await page.keyboard.press("Escape");
  await help.waitFor({ state: "hidden" });
  const frames = await page.evaluate(() => { window.backdropRunning = false; return window.backdropFrames; });
  if (!reduced) {
    for (const open of [true, false]) {
      const phase = frames.filter(frame => frame.open === open);
      assert.ok(new Set(phase.map(frame => frame.opacity)).size >= 3, `Backdrop did not animate ${open ? "in" : "out"}: ${JSON.stringify(phase)}`);
    }
    assert.ok(frames.some(frame => frame.animations.some(animation => animation.duration === 120 && animation.easing === "cubic-bezier(0.4, 0, 1, 1)")));
  } else assert.ok(frames.every(frame => frame.animations.length === 0));
  if (width === 1440) {
    await page.keyboard.press("Control+Shift+Backslash");
    await page.keyboard.press("Control+Shift+Backslash");
    await page.waitForFunction(() => document.activeElement?.matches(".preview"));
    assert.equal(await page.locator(".preview").getAttribute("tabindex"), "0");
    await page.keyboard.press("Control+Shift+Backslash");
    await page.waitForFunction(() => document.activeElement?.matches(".cm-content"));
  } else {
    assert.equal(await page.locator(".bar-words").isVisible(), true);
    await page.getByRole("button", { name: "More", exact: true }).click();
    assert.equal(await page.getByRole("menuitem", { name: /Commands|Keyboard shortcuts/ }).count(), 0);
    const firstItem = page.getByRole("menu", { name: "More", exact: true }).getByRole("menuitem").first();
    await firstItem.evaluate(element => { if (document.activeElement !== element) throw new Error("Touch More did not focus its first visible item"); });
    await page.keyboard.press("ArrowDown");
    assert.equal(await page.evaluate(() => document.activeElement?.matches('[role="menuitem"]') && getComputedStyle(document.activeElement).display !== "none"), true);
    await page.keyboard.press("Escape");
    await page.locator(".pane-tabs button").first().click();
  }
  const tabs = page.getByRole("tablist", { name: "Sidebar", exact: true });
  const outline = tabs.getByRole("tab", { name: "Outline", exact: true });
  await outline.click();
  assert.equal(await page.locator("#manuscript-search-keys:visible").count(), 0);
  await pressFill(page, outline);
  await pressFill(page, page.locator(".record-row").first());
  if (width === 390) assert.equal(await page.locator(".record-row").first().evaluate(element => getComputedStyle(element).alignItems), "center");
  await outline.focus();
  assert.equal(await outline.evaluate(element => getComputedStyle(element).borderBottomColor !== "rgba(0, 0, 0, 0)"), true);
  await page.keyboard.press("ArrowRight");
  await tabs.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)); });
  assert.equal(await outline.evaluate(element => getComputedStyle(element).borderBottomColor), "rgba(0, 0, 0, 0)");
  assert.equal(await tabs.locator('[aria-selected="true"]').evaluate(element => getComputedStyle(element).borderBottomColor !== "rgba(0, 0, 0, 0)"), true);
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "Split sidebar", exact: true }).click();
  const resize = page.getByRole("separator", { name: "Resize sidebar panels", exact: true });
  await resize.waitFor();
  await page.waitForTimeout(180);
  const height = await page.locator(".outline > .sidebar-panel").evaluate(element => element.getBoundingClientRect().height);
  await resize.press("ArrowUp");
  assert.equal(await resize.getAttribute("aria-valuenow"), "45");
  await page.locator(".outline").evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  assert.ok(await page.locator(".outline > .sidebar-panel").evaluate(element => element.getBoundingClientRect().height) < height);
  const box = await resize.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + 40, { steps: 4 });
  await page.mouse.up();
  assert.ok(Number(await resize.getAttribute("aria-valuenow")) > 45, `Drag did not resize: ${await resize.getAttribute("aria-valuenow")}`);
  await resize.press("Home");
  assert.equal(await resize.getAttribute("aria-valuenow"), "20");
  await resize.press("ArrowDown");
  await resize.press("End");
  assert.equal(await resize.getAttribute("aria-valuenow"), "80");
  await page.getByRole("button", { name: "Close the lower panel", exact: true }).click();
  if (width === 390) await page.getByRole("button", { name: "Write", exact: true }).click();
  await page.locator(".cm-content").focus();
}

try {
  for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"]) for (const reducedMotion of ["no-preference", "reduce"]) {
    const name = `${width}-${colorScheme}-${reducedMotion}`;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme, reducedMotion, hasTouch: width === 390, isMobile: width === 390 });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(`${base}?demo`);
      await page.locator(".home [data-path]").first().waitFor();
      assert.equal(await page.locator(".continue-card").count(), 0, "Continue must not invent open history");
      await pressFill(page, page.locator(".home [data-path]").first());
      await pressFill(page, page.locator(".home-header .mdbase-button.is-primary").first());
      assert.equal(await page.locator(".topbar .interface-language").count(), 0);
      if (width === 390) await touchTargets(page, ".topbar button:visible, .home button:visible, .home input:visible");
      await page.keyboard.press("j");
      assert.ok(await page.locator(".home [data-path]").first().evaluate(element => element === document.activeElement));
      await page.evaluate(() => {
        window.routeFrames = [];
        const sample = () => {
          const home = document.querySelector(".home");
          const workspace = document.querySelector(".workspace");
          const editor = document.querySelector(".editor");
          window.routeFrames.push({ home: Boolean(home && Number(getComputedStyle(home).opacity) > 0), workspace: Boolean(workspace && Number(getComputedStyle(workspace).opacity) > 0), editor: editor ? Number(getComputedStyle(editor).opacity) : null });
          if (!editor) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
      await page.keyboard.press("Enter");
      await page.getByRole("textbox", { name: "Markdown for chapters/reefs.md", exact: true }).waitFor();
      assert.equal(await page.locator(".editor").evaluate(element => element.getAnimations().length), 0, "First open must not add a nested editor fade");
      assert.ok((await page.evaluate(() => window.routeFrames)).every(frame => frame.home || frame.workspace), "Home to workspace has a dead frame");
      assert.ok((await page.evaluate(() => window.routeFrames)).every(frame => frame.editor === null || frame.editor > 0), "Editor starts blank");
      await typeInEditor(page, " OPEN_HANDOFF ");
      assert.ok(await page.evaluate(() => { const text = window.writer.workspace.getSnapshot().records.get("chapters/reefs.md").snapshot.body; return text.includes("\n\n OPEN_HANDOFF Darwin explained"); }), "First open must start on the first body line");
      await page.keyboard.press("Control+z");
      await page.keyboard.press("Control+End");
      await roundFive(page, width, reducedMotion === "reduce");
      await command(page, "Save now");
      assert.equal(await page.locator(".bar-problems.is-clear").count(), 0);
      const saveMark = await page.locator(".mdbase-signal-saved :is(.mdbase-mark-accent,.mdbase-mark-fence-top,.mdbase-mark-fence-bottom,.mdbase-mark-row-bottom)").evaluateAll(elements => elements.map(element => ({ duration: parseFloat(getComputedStyle(element).animationDuration), delay: parseFloat(getComputedStyle(element).animationDelay) })));
      if (reducedMotion === "no-preference") assert.ok(saveMark.length > 0 && saveMark.every(mark => mark.duration + mark.delay <= .401), JSON.stringify(saveMark));
      await typeInEditor(page, " PALETTE_RETURN ");
      const before = await page.evaluate(() => [...window.writer.workspace.getSnapshot().records].map(([path, record]) => [path, record.snapshot.body]));
      await command(page, "Find a source");
      await page.keyboard.type("earth");
      assert.equal(await page.getByRole("searchbox", { name: "Find a source", exact: true }).inputValue(), "earth");
      assert.deepEqual(await page.evaluate(() => [...window.writer.workspace.getSnapshot().records].map(([path, record]) => [path, record.snapshot.body])), before, "Palette destination query contaminated prose");
      await semantics(page);
      await page.keyboard.press("Enter");
      await typeInEditor(page, " CITATION_CONTINUATION ");
      await page.waitForFunction(() => !document.querySelector(".sync-status"));
      if (width === 390) await page.locator(".pane-tabs button").first().click();
      await page.getByRole("tab", { name: "Outline", exact: true }).click();
      await page.getByRole("button", { name: /^2 Earthworms/ }).click();
      await typeInEditor(page, " CHAPTER_HANDOFF ");
      await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
      await page.locator(".home [data-path]").first().waitFor();
      assert.ok(await page.locator('.home [data-path][data-path="manuscripts/patient-observation.md"]').evaluate(element => element === document.activeElement), "Back must restore originating row");
      await page.keyboard.press("Enter");
      await page.getByRole("textbox", { name: "Markdown for chapters/worms.md", exact: true }).waitFor();
      assert.ok(await page.locator(".editor").evaluate(element => Number(getComputedStyle(element).opacity) > 0));
      await typeInEditor(page, " REOPEN_HANDOFF ");
      await page.keyboard.press("Tab");
      assert.ok(await page.locator(".cm-content").evaluate(element => element !== document.activeElement), "Tab must leave the editor");
      if (width === 390) {
        await page.getByRole("button", { name: "Preview", exact: true }).click();
        await page.getByRole("button", { name: "Write", exact: true }).click();
      } else {
        await page.getByRole("button", { name: "Preview only", exact: true }).click();
        await page.getByRole("button", { name: "Editor and preview", exact: true }).click();
      }
      await typeInEditor(page, " VIEW_HANDOFF ");
      if (width !== 390) await page.getByRole("button", { name: "Preview only", exact: true }).click();
      await page.keyboard.press("Control+Shift+f");
      const manuscriptSearch = page.getByRole("searchbox", { name: "Search outline", exact: true });
      await manuscriptSearch.fill("darwin");
      await manuscriptSearch.press("Enter");
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Search outline");
      const beforeSearch = await page.evaluate(() => [...window.writer.workspace.getSnapshot().records].map(([path, record]) => [path, record.snapshot.body]));
      await page.keyboard.type(" earth");
      assert.equal(await manuscriptSearch.inputValue(), "darwin earth");
      assert.deepEqual(await page.evaluate(() => [...window.writer.workspace.getSnapshot().records].map(([path, record]) => [path, record.snapshot.body])), beforeSearch);
      await manuscriptSearch.fill("darwin");
      await page.locator(".search-hit").first().click();
      await typeInEditor(page, " SEARCH_HANDOFF ");
      await page.mouse.move(0, 0);
      const savedNotice = page.locator(".bar .mdbase-save-notice.is-saved").first();
      await savedNotice.waitFor({ state: "attached" });
      assert.equal(await savedNotice.isVisible(), width !== 390, "Phone keeps the existing quiet confirmed-save state");
      assert.equal(await page.locator('.bar-problems.is-clear,.bar-problems[title="No manuscript problems"]').count(), 0);
      if (reducedMotion === "no-preference") assert.equal(await savedNotice.evaluate(element => getComputedStyle(element).animationDuration), "0.4s");
      await page.keyboard.press("Control+/");
      const help = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
      await help.waitFor();
      assert.equal(await help.locator(".shortcuts > div").filter({ hasText: "Move to the next control" }).innerText(), "Tab\nMove to the next control");
      assert.match(await help.innerText(), /Find a source/);
      await page.keyboard.press("Escape");
      await help.waitFor({ state: "hidden" });
      await typeInEditor(page, " HELP_RETURN ");
      await page.keyboard.press("Control+,");
      await page.locator(".settings-sheet").waitFor();
      await semantics(page);
      assert.equal(await page.locator(".interface-language select").count(), 0);
      assert.equal(await page.locator(".interface-language [role=combobox]").count(), 1);
      await page.keyboard.press("Escape");
      await page.locator(".settings-sheet").waitFor({ state: "detached" });
      await typeInEditor(page, " SETTINGS_RETURN ");
      await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
      await page.locator(".home [data-path]").first().waitFor();
      await command(page, "New manuscript");
      const create = page.getByRole("dialog", { name: "New manuscript", exact: true });
      await create.waitFor();
      await page.keyboard.type("Round four manuscript");
      assert.equal(await create.getByRole("textbox", { name: "Title", exact: true }).inputValue(), "Round four manuscript");
      await create.getByRole("button", { name: "Create manuscript", exact: true }).click();
      await create.waitFor({ state: "hidden" });
      await typeInEditor(page, " CREATE_HANDOFF ");
      await page.evaluate(() => document.fonts.ready);
      assert.match(await page.locator(".cm-scroller").evaluate(element => getComputedStyle(element).fontFamily), /Atkinson Hyperlegible Next/);
      const session = await context.newCDPSession(page);
      await session.send("DOM.enable");
      await session.send("CSS.enable");
      const { root } = await session.send("DOM.getDocument");
      const { nodeId } = await session.send("DOM.querySelector", { nodeId: root.nodeId, selector: ".cm-line" });
      const { fonts } = await session.send("CSS.getPlatformFontsForNode", { nodeId });
      assert.ok(fonts.some(font => /Atkinson Hyperlegible Next/i.test(font.familyName) && font.isCustomFont), JSON.stringify(fonts));
      if (width === 390) await touchTargets(page, ".topbar button:visible, .pane-tabs button:visible");
      await page.screenshot({ path: `out/polish-r4/${name}.png` });
      await continuePosition(page, width, reducedMotion === "reduce");
      await page.goto(`${base}?demo`);
      await page.locator(".home [data-path]").first().waitFor();
      await page.evaluate(async () => { window.nativeFixture = await (await import("/scripts/browser-a11y-fixture.tsx")).mountNative(); });
      await page.locator('.home [data-path][data-path="writing/main.md"]').waitFor();
      for (const state of ["signed_out", "needs_setup"]) {
        await page.evaluate(state => {
          window.nativeFixture.controls.setSetupPlan({ status: "setup", canApply: true, digest: "round-four-semantics", summary: "Add the types Writer needs.", changes: ["manuscript", "source", "comment"].map(name => ({ kind: "create", target: `_types/${name}.md`, message: `Add the ${name} type` })), conflicts: [], adoptable: {}, packs: [], staged: [], records: [] });
          window.nativeFixture.set(state);
        }, state);
        await page.getByRole("button", { name: state === "signed_out" ? "Sign in" : "Set up", exact: true }).waitFor();
        await semantics(page);
        assert.equal(await page.locator(".mdbase-collections-brand:visible").count(), 0);
        if (state === "needs_setup") {
          assert.equal(await page.locator(".mdbase-collections-lead").count(), 0);
          const heading = page.locator(".mdbase-collections-setup-section h2").first();
          assert.deepEqual(await heading.evaluate(element => {
            const style = getComputedStyle(element);
            return { margin: style.margin, fontSize: style.fontSize, fontWeight: style.fontWeight };
          }), { margin: "0px", fontSize: "12px", fontWeight: "600" });
          await page.screenshot({ path: `out/polish-r4/${name}-setup.png` });
        }
      }
      await page.evaluate(() => window.nativeFixture.close());
      assert.deepEqual(errors, []);
      results.push({ name, ok: true });
      console.log(`ok round four focus, fonts, semantics and keyboard ${name}`);
    } catch (error) {
      results.push({ name, ok: false, error: String(error) });
      await page.screenshot({ path: `out/polish-r4/${name}-failure.png` });
      console.error(`FAIL ${name}: ${error.stack}`);
    } finally {
      await context.close();
      writeFileSync("out/polish-r4/matrix.json", JSON.stringify(results, null, 2));
    }
  }
  assert.ok(results.every(result => result.ok), "Round four polish matrix failed");
  for (const platform of ["MacIntel", "Win32", "Linux x86_64"]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await context.addInitScript(platform => Object.defineProperty(navigator, "platform", { value: platform }), platform);
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    try {
      const apple = platform === "MacIntel";
      const mod = apple ? "Meta" : "Control";
      await page.goto(`${base}?demo`);
      await page.locator(".home [data-path]").first().click();
      await page.locator(".cm-content").focus();
      await page.keyboard.press(`${mod}+/`);
      const help = page.locator(".shortcuts-dialog");
      await help.waitFor();
      const keys = label => help.locator(".shortcuts > div").evaluateAll((rows, label) => rows.filter(row => row.querySelector("dd").textContent === label).map(row => row.querySelector("kbd").textContent), label);
      assert.deepEqual(await keys("Go to line"), [apple ? "⌘⌥G" : "Ctrl+Alt+G"]);
      assert.deepEqual(await keys("Undo"), [apple ? "⌘Z" : "Ctrl+Z"]);
      assert.deepEqual(await keys("Redo"), apple ? ["⌘⇧Z"] : platform.startsWith("Linux") ? ["Ctrl+Y", "Ctrl+Shift+Z"] : ["Ctrl+Y"]);
      assert.deepEqual(await keys("Show completions"), [apple ? "⌃Space" : "Ctrl+Space"]);
      assert.equal(await help.getByText("Move to the next control", { exact: true }).count(), 1);
      assert.equal(await help.getByText("In the editor, press Tab to move to the next control.", { exact: true }).count(), 0);
      await page.keyboard.press("Escape");
      await help.waitFor({ state: "hidden" });
      assert.equal(await page.locator("#sidebar-tab-sources").getAttribute("title"), `Find a source (${apple ? "⌘⇧E" : "Ctrl+Shift+E"})`);
      assert.equal(await page.getByRole("button", { name: "Export formats", exact: true }).getAttribute("title"), `Export formats (${apple ? "⌘⇧S" : "Ctrl+Shift+S"})`);
      await page.keyboard.press(`${mod}+Alt+g`);
      const line = page.locator('.cm-goto-line input[name="line"]');
      await line.waitFor();
      await page.keyboard.press(`${mod}+a`);
      await page.keyboard.type("3");
      await page.keyboard.press("Enter");
      const state = () => page.evaluate(async () => (await import("/scripts/browser-a11y-fixture.tsx")).editorSnapshot());
      const before = await state();
      assert.equal(before.text.slice(0, before.head).split("\n").length, 3);
      await page.keyboard.type("KEYBOARD_REDO");
      assert.notEqual((await state()).text, before.text);
      await page.keyboard.press(`${mod}+z`);
      assert.equal((await state()).text, before.text);
      for (const key of [apple ? "Meta+Shift+z" : "Control+y", ...(platform.startsWith("Linux") ? ["Control+Shift+z"] : [])]) {
        await page.keyboard.press(key);
        assert.ok((await state()).text.includes("KEYBOARD_REDO"), `${key} did not redo`);
        await page.keyboard.press(`${mod}+z`);
        assert.equal((await state()).text, before.text);
      }
      await page.keyboard.type("@");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+Space");
      await page.locator(".cm-tooltip-autocomplete").waitFor();
      assert.ok(await page.getByRole("option").count() > 0);
      console.log(`ok platform keyboard reference and commands ${platform}`);
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
}
