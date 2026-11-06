import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import axe from "axe-core";

const base = process.env.BASE ?? "http://127.0.0.1:5320/";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
mkdirSync("out/polish-r6", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const results = [];
const ready = page => page.waitForFunction(() => {
  const snapshot = window.writer?.workspace?.getSnapshot();
  return snapshot?.phase === "ready" && snapshot.indexLoad.phase !== "loading" && snapshot.libraryLoad.phase !== "loading" && document.activeElement?.matches(".cm-content");
});
async function command(page, text) {
  await page.keyboard.press("Control+k");
  const input = page.locator(".mdbase-command-palette input");
  await input.fill(text);
  const option = page.locator('.mdbase-command-palette [role="option"]').filter({ has: page.getByText(text, { exact: true }) });
  await option.waitFor();
  const index = await option.evaluate(element => [...element.parentElement.children].filter(child => child.matches('[role="option"]')).indexOf(element));
  assert.ok(index >= 0);
  for (let step = 0; step < index; step++) await page.keyboard.press("ArrowDown");
  await page.waitForFunction(text => [...document.querySelectorAll('.mdbase-command-palette [role="option"]')].some(element => element.querySelector("strong")?.textContent === text && element.getAttribute("aria-selected") === "true"), text);
  await page.keyboard.press("Enter");
  await input.waitFor({ state: "hidden" });
}
async function settings(page, width) {
  if (width === 390) {
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
  } else await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".settings-sheet[open]").waitFor();
}
try {
  for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, hasTouch: true, isMobile: width === 390 });
    await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      console.log(`Round 6: ${width}px ${colorScheme}`);
      await page.goto(`${base}?demo&collection=lab-only-round-six`);
      await page.locator('.home [data-path][data-path="manuscripts/patient-observation.md"]').waitFor();
      await page.locator(".mdbase-app-switcher").click();
      const hrefs = await page.locator('a[role="menuitem"]').evaluateAll(elements => elements.map(element => element.href));
      assert.ok(hrefs.some(href => new URL(href).origin === "https://editor-lab.mdbase.dev"), JSON.stringify(hrefs));
      assert.ok(hrefs.some(href => new URL(href).origin === "https://lab.mdbase-reader.pages.dev"), JSON.stringify(hrefs));
      assert.ok(hrefs.every(href => new URL(href).searchParams.get("collection") === "lab-only-round-six"));
      assert.ok(hrefs.every(href => !["https://editor.mdbase.dev", "https://reader.mdbase.dev"].includes(new URL(href).origin)));
      await page.keyboard.press("Escape");
      await page.evaluate(() => {
        window.firstFrames = [];
        const observer = new MutationObserver(() => {
          const editor = document.querySelector(".cm-content");
          if (!editor) return;
          const button = document.querySelector(".split-button .is-primary");
          window.firstFrames.push({ words: document.querySelector(".bar-words")?.textContent, chip: document.querySelector(".cm-lp-chip.is-ref")?.textContent, paper: Boolean(document.querySelector(".preview-page")), exportBackground: getComputedStyle(button).backgroundColor, exportTransition: getComputedStyle(button).transitionDuration, editorAnimations: document.querySelector(".editor").getAnimations().length });
        });
        observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      });
      await page.locator('.home [data-path][data-path="manuscripts/patient-observation.md"]').click();
      await ready(page);
      const first = await page.evaluate(() => window.firstFrames[0]);
      assert.match(first.words, /124/);
      assert.ok(first.paper, JSON.stringify(first));
      assert.ok(first.chip?.includes("Earthworms"), JSON.stringify(first));
      assert.equal(first.exportTransition, "0s");
      assert.equal(first.editorAnimations, 0);
      await page.waitForFunction(() => document.querySelector(".workspace")?.dataset.ready === "true");
      assert.equal(first.exportBackground, await page.locator(".split-button .is-primary").first().evaluate(element => getComputedStyle(element).backgroundColor));
      const words = await page.locator(".bar-words").innerText();
      const toolbar = await page.locator(".bar").boundingBox();
      const editorTop = (await page.locator(".cm-editor").boundingBox()).y;
      await page.keyboard.type(" ROUND_SIX ", { delay: 20 });
      await page.waitForFunction(() => [...window.writer.workspace.getSnapshot().records.values()].some(record => record.snapshot.body.includes("ROUND_SIX")));
      assert.equal((await page.locator(".cm-editor").boundingBox()).y, editorTop);
      assert.equal((await page.locator(".bar").boundingBox()).height, toolbar.height);
      await page.waitForFunction(() => [...window.writer.workspace.getSnapshot().records.values()].every(record => record.snapshot.state === "saved"));
      assert.equal((await page.locator(".cm-editor").boundingBox()).y, editorTop);
      if (width === 390) {
        assert.ok((await page.locator(".bar-title").boundingBox()).width >= 100);
        assert.ok(toolbar.height <= 96, `Toolbar grew a third row: ${toolbar.height}`);
      }
      await settings(page, width);
      if (width === 390) {
        await page.keyboard.press("Escape");
        await page.keyboard.type(" MENU_SETTINGS_RESUMED ");
        await page.waitForFunction(() => [...window.writer.workspace.getSnapshot().records.values()].some(record => record.snapshot.body.includes("MENU_SETTINGS_RESUMED")));
        await page.locator(".settings-sheet").waitFor({ state: "hidden" });
        await settings(page, width);
        assert.equal(await page.locator(".settings-sheet").evaluate(element => element.matches(":modal")), true);
        for (const key of ["Tab", "Shift+Tab"]) for (let step = 0; step < 35; step++) {
          await page.keyboard.press(key);
          const focused = await page.evaluate(() => {
            const active = document.activeElement;
            if (!active?.closest(".settings-sheet")) return { valid: false, tag: active?.tagName, focused: document.hasFocus() };
            const box = active.getBoundingClientRect();
            return { valid: box.bottom > 0 && box.top < innerHeight && active.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)), tag: active.outerHTML.slice(0, 300), box: box.toJSON(), hit: document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)?.outerHTML.slice(0, 100) };
          });
          assert.equal(focused.valid, true, `Settings lost visible focus after ${key} ${step}: ${JSON.stringify(focused)}`);
        }
      } else assert.equal(await page.locator(".settings-sheet").evaluate(element => element.matches(":modal")), false);
      await page.keyboard.press("Escape");
      await page.keyboard.type(" SETTINGS_RESUMED ");
      await page.locator(".settings-sheet").waitFor({ state: "hidden" });
      await page.waitForFunction(() => [...window.writer.workspace.getSnapshot().records.values()].some(record => record.snapshot.body.includes("SETTINGS_RESUMED")));
      const beforeFind = await page.evaluate(() => [...window.writer.workspace.getSnapshot().records].map(([path, record]) => [path, record.snapshot.body]));
      if (width === 390) {
        await page.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("menuitem", { name: "Find in chapter", exact: true }).click();
      } else await command(page, "Find in chapter");
      await page.locator(".writer-find").waitFor();
      await page.waitForFunction(() => document.activeElement?.matches('.writer-find input[name="search"]'));
      await page.keyboard.type("ROUND_SIX", { delay: 20 });
      assert.equal(await page.locator('.writer-find input[name="search"]').inputValue(), "ROUND_SIX");
      assert.deepEqual(await page.evaluate(() => [...window.writer.workspace.getSnapshot().records].map(([path, record]) => [path, record.snapshot.body])), beforeFind);
      await page.keyboard.press("Enter");
      if (width === 390) for (const box of await page.locator(".writer-find button, .writer-find summary").evaluateAll(elements => elements.filter(element => element.checkVisibility()).map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })))) assert.ok(box.width >= 43.99 && box.height >= 43.99, JSON.stringify(box));
      await page.keyboard.press("Escape");
      await page.locator(".cm-content").focus();
      await command(page, "Earthworms");
      await ready(page);
      await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent.includes("Earthworms"));
      await page.keyboard.press("Control+End");
      await page.keyboard.type(" EARTHWORMS_RETURN ");
      await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
      await page.locator(".continue-card").waitFor();
      await page.waitForFunction(() => document.querySelector(".continue-card")?.textContent.includes("Earthworms"));
      assert.equal(await page.locator('.home [data-path="manuscripts/patient-observation.md"]').count(), 1);
      await page.locator(".continue-card").getByRole("button", { name: /^Continue/ }).click();
      await ready(page);
      await page.keyboard.type("CARET_RETURN");
      await page.waitForFunction(() => [...window.writer.workspace.getSnapshot().records.values()].some(record => record.snapshot.body.includes("EARTHWORMS_RETURN CARET_RETURN")));
      if (width === 1440) {
        await page.getByRole("button", { name: "Editor only", exact: true }).click();
        await page.waitForFunction(() => document.querySelector(".workspace")?.classList.contains("view-write") && document.activeElement?.matches(".cm-content"));
        await command(page, "Editor and preview");
        await page.waitForFunction(() => document.querySelector(".preview canvas[data-version]"), null, { timeout: 60000 });
        await page.evaluate(() => {
          window.paneSamples = [];
          window.samplePanes = true;
          const sample = () => {
            const pane = document.querySelector(".preview-pane");
            const paper = document.querySelector(".preview-page");
            window.paneSamples.push({ opacity: getComputedStyle(pane).opacity, width: paper.getBoundingClientRect().width, pane: pane.getBoundingClientRect().width, animations: pane.getAnimations().length });
            if (window.samplePanes) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        await page.keyboard.press("Control+Backslash");
        await page.waitForFunction(() => window.paneSamples.length >= 12);
        const samples = await page.evaluate(() => { window.samplePanes = false; return window.paneSamples; });
        assert.ok(samples.every(sample => sample.opacity === "1" && sample.animations === 0));
        for (let index = 1; index < samples.length; index++) if (Math.abs(samples[index].pane - samples[index - 1].pane) < 1) assert.ok(Math.abs(samples[index].width - samples[index - 1].width) < 1, "Fit changed after pane layout");
        await page.locator(".preview").focus();
        await page.keyboard.press("Tab");
        assert.deepEqual(await page.evaluate(() => ({ tag: document.activeElement.tagName, focused: document.hasFocus(), tabindex: document.body.getAttribute("tabindex") })), { tag: "BODY", focused: false, tabindex: null });
        await page.keyboard.press("Tab");
        assert.equal(await page.evaluate(() => document.activeElement.matches(".mdbase-app-switcher")), true);
      } else {
        await page.getByRole("button", { name: "Preview", exact: true }).click();
        await page.waitForFunction(() => document.querySelector(".preview canvas[data-version]"), null, { timeout: 60000 });
        await page.evaluate(() => {
          window.phonePreviewFrames = [];
          window.samplePhonePreview = true;
          const sample = () => {
            const pane = document.querySelector(".preview-pane");
            window.phonePreviewFrames.push({ opacity: getComputedStyle(pane).opacity, animations: pane.getAnimations().length });
            if (window.samplePhonePreview) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        });
        await page.getByRole("button", { name: "Write", exact: true }).click();
        await page.getByRole("button", { name: "Preview", exact: true }).click();
        await page.waitForFunction(() => window.phonePreviewFrames.length >= 12);
        const frames = await page.evaluate(() => { window.samplePhonePreview = false; return window.phonePreviewFrames; });
        assert.ok(frames.every(frame => frame.opacity === "1" && frame.animations === 0), JSON.stringify(frames));
        await page.getByRole("button", { name: "Write", exact: true }).click();
      }
      if (width === 390) await page.getByRole("button", { name: "Sidebar", exact: true }).click();
      else await command(page, "Show the sidebar");
      await page.getByRole("tab", { name: /Sources/ }).click();
      const source = page.locator(".source-line").first();
      await source.waitFor();
      const sourceGeometry = await source.evaluate(element => {
        const title = element.querySelector(".source-title").getBoundingClientRect();
        const cite = element.querySelector(".cite-button").getBoundingClientRect();
        const row = element.querySelector(".source-row").getBoundingClientRect();
        return { titleBottom: title.bottom, citeTop: cite.top, titleWidth: title.width, rowWidth: row.width };
      });
      assert.ok(sourceGeometry.citeTop >= sourceGeometry.titleBottom, JSON.stringify(sourceGeometry));
      assert.ok(sourceGeometry.titleWidth >= sourceGeometry.rowWidth - 17, JSON.stringify(sourceGeometry));
      if (width === 390) {
        await page.getByRole("button", { name: "Write", exact: true }).click();
        await page.waitForFunction(() => getComputedStyle(document.querySelector(".outline")).visibility === "hidden" && getComputedStyle(document.querySelector(".write")).opacity === "1");
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: `out/polish-r6/${width}-${colorScheme}.png` });
      assert.deepEqual(errors, []);
      results.push({ width, colorScheme, first, toolbar, words, passed: true });
    } catch (error) {
      console.error(error);
      console.error(await page.evaluate(() => ({ active: document.activeElement?.outerHTML, dialogs: [...document.querySelectorAll('dialog[open]')].map(element => ({ html: element.outerHTML.slice(0, 180), inert: element.inert })) })));
      await page.screenshot({ path: `out/polish-r6/${width}-${colorScheme}-failure.png` });
      throw error;
    } finally { await context.close(); }
  }
  const page = await browser.newPage();
  await page.goto(`${base}?demo`);
  await page.locator(".home [data-path]").first().waitFor();
  await page.evaluate(async () => { window.nativeFixture = await (await import("/scripts/browser-a11y-fixture.tsx")).mountNative("# Clean chapter\n\nNo problems here.\n"); });
  await page.locator('.home [data-path][data-path="writing/main.md"]').click();
  await ready(page);
  await page.waitForFunction(() => { const snapshot = window.writer.workspace.getSnapshot(); return snapshot.result && !snapshot.compiling; });
  await page.evaluate(() => {
    window.problemAnnouncements = [];
    new MutationObserver(() => { if (document.querySelector(".problem-announcement")?.textContent.includes("No manuscript problems")) window.problemAnnouncements.push(document.querySelector(".problem-announcement").textContent); }).observe(document.querySelector(".problem-announcement"), { subtree: true, childList: true, characterData: true });
  });
  for (const key of ["F8", "Shift+F8"]) {
    const before = await page.evaluate(() => window.problemAnnouncements.length);
    await page.keyboard.press(key);
    await page.waitForFunction(before => window.problemAnnouncements.length > before, before);
  }
  await page.evaluate(() => window.writer.workspace.patchFrontmatter(window.writer.workspace.main, { template: "round-six-unknown" }));
  await page.waitForFunction(() => window.writer.workspace.getSnapshot().result?.diagnostics.some(diagnostic => diagnostic.field === "template"));
  const announcements = await page.evaluate(() => window.problemAnnouncements.length);
  await page.keyboard.press("F8");
  await page.keyboard.type(" SETTINGS_PROBLEM_REMAINS ");
  await page.waitForFunction(() => [...window.writer.workspace.getSnapshot().records.values()].every(record => record.snapshot.state === "saved"));
  assert.equal(await page.evaluate(() => window.problemAnnouncements.length), announcements, "Settings problems must not be announced as an empty manuscript");
  await page.close();
  for (const colorScheme of ["light", "dark"]) {
    const context = await browser.newContext({ colorScheme });
    await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    await page.goto(`${base}?demo`);
    await page.locator('.home [data-path="manuscripts/patient-observation.md"]').click();
    await ready(page);
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("\n\n> A quoted passage.\n\nA note[^r6].\n\n[^r6]: See [@darwinFormation81, p. 12].\n\nEnd.\n");
    const quote = page.locator(".cm-lp-quote").filter({ hasText: /^A quoted passage\.$/ });
    await quote.waitFor();
    assert.equal(await quote.textContent(), "A quoted passage.");
    const citation = page.locator(".cm-lp-footnote .is-cite").filter({ hasText: "Darwin" });
    await citation.waitFor();
    assert.match(await citation.textContent(), /Darwin/);
    await citation.evaluate(element => element.parentElement.classList.add("cm-comment"));
    await page.evaluate(axe.source);
    const contrast = await page.evaluate(() => window.axe.run(".cm-lp-footnote", { runOnly: ["color-contrast"] }));
    assert.deepEqual(contrast.violations, []);
    await context.close();
  }
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const limit = await context.newPage();
  await limit.goto(`${base}?demo`);
  await limit.locator(".home [data-path]").first().waitFor();
  await limit.evaluate(async () => { window.limitFixture = await (await import("/scripts/browser-a11y-fixture.tsx")).mountCollectionLimit(); });
  await limit.getByRole("button", { name: "Add a collection…", exact: true }).click();
  const notice = limit.getByRole("alert").filter({ hasText: "Synced collection limit reached" });
  await notice.waitFor();
  assert.match(await notice.textContent(), /Open an existing collection, delete one you own if Delete is available, or contact mdbase support to raise your limit/);
  assert.equal(await limit.getByRole("button", { name: /Try again|Add a collection/ }).count(), 0);
  assert.equal(await notice.evaluate(element => element.parentElement.matches(".mdbase-collections-actions")), true);
  assert.equal(await notice.evaluate(element => { const box = element.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }), true);
  await limit.getByRole("link", { name: "Manage access", exact: true }).waitFor();
  await context.close();
  const failureContext = await browser.newContext();
  await failureContext.route("**/*", route => route.request().resourceType() === "fetch" && /\.wasm(?:\?|$)/.test(route.request().url()) ? route.fulfill({ status: 200, contentType: "application/wasm", body: "invalid WebAssembly round-six diagnostic" }) : new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const failure = await failureContext.newPage();
  const diagnostics = [];
  failure.on("console", message => { if (message.type() === "error") diagnostics.push(message.text()); });
  await failure.goto(`${base}?demo`);
  await failure.locator('.home [data-path="manuscripts/patient-observation.md"]').click();
  await failure.getByRole("alert").filter({ hasText: "The preview could not be loaded. You can keep writing." }).waitFor();
  assert.equal(await failure.getByText(/WebAssembly|CompileError|magic word/i).count(), 0);
  assert.ok(diagnostics.some(message => message.includes("Writer preview:")), JSON.stringify(diagnostics));
  await failure.locator(".cm-content").focus();
  await failure.keyboard.type(" STILL_WRITING ");
  await failure.waitForFunction(() => [...window.writer.workspace.getSnapshot().records.values()].some(record => record.snapshot.body.includes("STILL_WRITING")));
  await failureContext.close();
  writeFileSync("out/polish-r6/results.json", JSON.stringify(results, null, 2));
  console.log("Round 6 interaction gates passed");
} finally { await browser.close(); }
