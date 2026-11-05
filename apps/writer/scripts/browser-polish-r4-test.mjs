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
      await page.locator(".manuscript-row").first().waitFor();
      assert.equal(await page.locator(".topbar .interface-language").count(), 0);
      if (width === 390) await touchTargets(page, ".topbar button:visible, .home button:visible, .home input:visible");
      await page.keyboard.press("j");
      assert.ok(await page.locator(".manuscript-row").first().evaluate(element => element === document.activeElement));
      await page.keyboard.press("Enter");
      await page.getByRole("textbox", { name: "Markdown for chapters/reefs.md", exact: true }).waitFor();
      await typeInEditor(page, " OPEN_HANDOFF ");
      await page.keyboard.press("Control+z");
      await page.keyboard.press("Control+End");
      const before = await page.evaluate(() => [...window.writer.workspace.getSnapshot().records].map(([path, record]) => [path, record.snapshot.body]));
      await command(page, "Find a source");
      await page.keyboard.type("earth");
      assert.equal(await page.getByRole("searchbox", { name: "Find a source", exact: true }).inputValue(), "earth");
      assert.deepEqual(await page.evaluate(() => [...window.writer.workspace.getSnapshot().records].map(([path, record]) => [path, record.snapshot.body])), before, "Palette destination query contaminated prose");
      await semantics(page);
      await page.keyboard.press("Enter");
      await typeInEditor(page, " CITATION_CONTINUATION ");
      if (width === 390) await page.locator(".pane-tabs button").first().click();
      await page.getByRole("tab", { name: "Outline", exact: true }).click();
      await page.getByRole("button", { name: /^2 Earthworms/ }).click();
      await typeInEditor(page, " CHAPTER_HANDOFF ");
      await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
      await page.locator(".manuscript-row").first().waitFor();
      assert.ok(await page.locator('.manuscript-row[data-path="manuscripts/patient-observation.md"]').evaluate(element => element === document.activeElement), "Back must restore originating row");
      await page.keyboard.press("Enter");
      await page.getByRole("textbox", { name: "Markdown for chapters/worms.md", exact: true }).waitFor();
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
      const manuscriptSearch = page.getByRole("searchbox", { name: "Search the manuscript", exact: true });
      await manuscriptSearch.fill("darwin");
      await manuscriptSearch.press("Enter");
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Search the manuscript");
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
      if (reducedMotion === "no-preference") assert.equal(await savedNotice.evaluate(element => getComputedStyle(element).animationDuration), "0.4s");
      await page.keyboard.press("Control+/");
      const help = page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true });
      await help.waitFor();
      assert.match(await help.innerText(), /press Tab to move/);
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
      await page.locator(".manuscript-row").first().waitFor();
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
      await page.goto(`${base}?demo`);
      await page.locator(".manuscript-row").first().waitFor();
      await page.evaluate(async () => { window.nativeFixture = await (await import("/scripts/browser-a11y-fixture.tsx")).mountNative(); });
      await page.locator('.manuscript-row[data-path="writing/main.md"]').waitFor();
      for (const state of ["signed_out", "needs_setup"]) {
        await page.evaluate(state => {
          window.nativeFixture.controls.setSetupPlan({ status: "setup", canApply: true, digest: "round-four-semantics", summary: "Add the types Writer needs.", changes: ["manuscript", "source", "comment"].map(name => ({ kind: "create", target: `_types/${name}.md`, message: `Add the ${name} type` })), conflicts: [], adoptable: {}, packs: [], staged: [], records: [] });
          window.nativeFixture.set(state);
        }, state);
        await page.getByRole("button", { name: state === "signed_out" ? "Sign in" : "Set up", exact: true }).waitFor();
        await semantics(page);
        assert.equal(await page.locator(".mdbase-collections-brand:visible").count(), 0);
        if (state === "needs_setup") {
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
} finally {
  await browser.close();
}
