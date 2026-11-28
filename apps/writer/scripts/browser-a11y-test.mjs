// Loopback-only demo data; external requests (including Connect) are blocked.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import axe from "axe-core";
import { chromium } from "playwright";

const base = process.argv[2] ?? process.env.BASE ?? "http://127.0.0.1:5320/";
const origin = new URL(base).origin;
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname));
await mkdir("out", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
let failures = 0;
let audits = 0;
const wcag = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22a", "wcag22aa"];

async function audit(page, name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity
    ).map(animation => animation.finished.catch(() => {})));
  });
  await page.evaluate(axe.source);
  const results = await page.evaluate(tags => window.axe.run(document, {
    runOnly: { type: "tag", values: tags },
    // This speech-input rule is opt-in in axe, including the production sweep.
    rules: { "label-content-name-mismatch": { enabled: true } },
  }), wcag);
  audits++;
  const contrastNeedsReview = results.incomplete.filter(({ id }) => id === "color-contrast");
  // Axe leaves single characters (including real numeric badges) undecided.
  // Use its measured ratio when it can identify both colors.
  const shortText = contrastNeedsReview.flatMap(({ nodes }) => nodes.filter(node =>
    node.any.some(({ data }) => data?.messageKey === "shortTextContent" &&
      data.fgColor && data.bgColor && data.contrastRatio < Number.parseFloat(data.expectedContrastRatio))
  ));
  await writeFile(`out/a11y-${name}.json`, JSON.stringify({ violations: results.violations, shortText, contrastNeedsReview }, null, 2));
  const violations = results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(n => n.target) }));
  if (shortText.length) violations.push({ id: "color-contrast (short text)", targets: shortText.map(n => n.target) });
  if (violations.length) {
    failures++;
    await page.screenshot({ path: `out/a11y-${name}.png`, fullPage: true });
    console.error(`FAIL ${name}: ${JSON.stringify(violations)}`);
  } else console.log(`PASS ${name}: no WCAG AA axe violations`);
}

async function escapeTo(page, dialog, opener) {
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await page.waitForFunction(element => element === document.activeElement, await opener.elementHandle());
  assert.ok(await opener.evaluate(el => el === document.activeElement), "Escape must return focus to the opener");
}

try {
  for (const [width, colorScheme] of [390, 1280].flatMap(width => ["light", "dark"].map(theme => [width, theme]))) {
    const scenario = `${width}-${colorScheme}`;
    const context = await browser.newContext({
      viewport: { width, height: width === 390 ? 844 : 900 },
      colorScheme,
      hasTouch: width === 390,
    });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    try {
      await page.goto(`${base}?demo`);
      await page.getByRole("heading", { name: "Manuscripts", exact: true }).waitFor();
      await page.evaluate(async () => (await import("/scripts/browser-a11y-fixture.tsx")).mountSignIn());
      await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
      await audit(page, `signin-${scenario}`);

      await page.goto(`${base}?demo`);
      await page.getByRole("heading", { name: "Manuscripts", exact: true }).waitFor();
      await audit(page, `home-${scenario}`);
      const create = page.getByRole("button", { name: "New manuscript", exact: true });
      await create.click();
      await audit(page, `new-manuscript-${scenario}`);
      await page.getByRole("button", { name: "Use a note you already have…" }).click();
      const note = page.locator(".note-option").first();
      await note.focus();
      await page.keyboard.press("Enter");
      assert.equal(await note.getAttribute("aria-pressed"), "true");
      await audit(page, `adopt-note-${scenario}`);
      await escapeTo(page, page.getByRole("dialog", { name: "New manuscript", exact: true }), create);

      await page.locator(".manuscripts > li", { hasText: "Small Agents, Large Effects" }).locator("[data-path]").click();
      await page.waitForFunction(() => {
        const snap = window.writer?.workspace?.getSnapshot();
        return snap?.artifact && !snap.compiling;
      }, null, { timeout: 60_000 });
      if (width < 900) {
        assert.equal(await page.locator(".preview").evaluate(element => element.checkVisibility({ visibilityProperty: true })), false);
        await audit(page, `editor-${scenario}`);
        await page.getByRole("navigation", { name: "View", exact: true }).getByRole("button", { name: /Preview/ }).click();
      }
      await page.waitForFunction(() => {
        const snap = window.writer?.workspace?.getSnapshot();
        const canvas = document.querySelector(".preview canvas[data-version]");
        return snap?.artifact && !snap.compiling && Number(document.querySelector(".preview-pages")?.dataset.renderedRevision) === snap.artifactRevision && canvas?.checkVisibility({ visibilityProperty: true });
      }, null, { timeout: 60_000 });
      if (width < 900) {
        await audit(page, `preview-${scenario}`);
        await page.getByRole("navigation", { name: "View", exact: true }).getByRole("button", { name: /Sidebar/ }).click();
      } else await audit(page, `editor-${scenario}`);
      for (const name of ["Outline", "Sources", "Comments"]) {
        await page.getByRole("tab", { name: new RegExp(name) }).click();
        if (name === "Sources") await page.locator(".source-row").first().waitFor();
        if (name === "Comments") await page.waitForFunction(() => window.writer.workspace.getSnapshot().commentsLoad.phase === "ready");
        await audit(page, `${name.toLowerCase()}-${scenario}`);
      }
      const outlineSearch = page.getByRole("searchbox", { name: "Search outline", exact: true });
      await page.getByRole("tab", { name: "Outline", exact: true }).click();
      await outlineSearch.fill("Darwin");
      await page.locator(".search-hit").first().waitFor();
      await audit(page, `outline-search-${scenario}`);
      await outlineSearch.clear();
      await page.getByRole("tab", { name: /Sources/ }).click();
      const sourceSearch = page.locator(".sources input[type=search]");
      await sourceSearch.fill("darwinFormation81");
      await page.locator('.source-row[data-key="darwinFormation81"]').click();
      await page.getByRole("textbox", { name: /^Page or locator for / }).waitFor();
      await audit(page, `citation-details-${scenario}`);
      await sourceSearch.clear();
      await page.getByRole("tab", { name: /Comments/ }).click();

      await page.getByRole("button", { name: "Split sidebar", exact: true }).click();
      await audit(page, `split-sidebar-${scenario}`);
      await page.getByRole("button", { name: "Close the lower panel", exact: true }).click();
      if (width < 900) await page.getByRole("navigation", { name: "View", exact: true }).getByRole("button", { name: /Write/ }).click();
      const settings = page.getByRole("button", { name: "Settings", exact: true });
      if (width < 900) {
        await page.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
      } else await settings.click();
      await audit(page, `settings-${scenario}`);
      await escapeTo(page, page.getByRole("dialog", { name: "Manuscript settings", exact: true }), page.locator(".cm-content"));

      const more = page.getByRole("button", { name: "More", exact: true });
      await page.locator(".cm-content").focus();
      await page.keyboard.press("Control+End");
      await page.keyboard.press("Enter");
      await page.keyboard.insertText("[@darwin");
      const completion = page.locator(".cm-tooltip-autocomplete [role=option]").first();
      await completion.waitFor();
      await audit(page, `citation-completion-${scenario}`);
      await page.keyboard.press("Escape");
      await completion.waitFor({ state: "hidden" });
      for (const name of ["Keyboard shortcuts", "Commands"]) {
        if (width < 900) await page.keyboard.press(name === "Commands" ? "Control+k" : "Control+/");
        else {
          await more.click();
          await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
        }
        const dialog = page.getByRole("dialog", { name: name === "Commands" ? "Writer commands" : name, exact: true });
        await dialog.waitFor();
        await audit(page, `${name.toLowerCase().replaceAll(" ", "-")}-${scenario}`);
        await escapeTo(page, dialog, width < 900 ? page.locator(".cm-content") : more);
      }
      await page.evaluate(() => {
        const { workspace } = window.writer;
        workspace.setBody(workspace.main, "# Export check\n\nMissing citation [@a11y-missing].\n");
      });
      const exportMenu = width < 900 ? more : page.getByRole("button", { name: "Export formats" });
      await exportMenu.click();
      const word = page.getByRole("menuitem").filter({ has: page.getByText("Word (DOCX)", { exact: true }) });
      await word.waitFor();
      await audit(page, `export-menu-${scenario}`);
      await word.click();
      const exportReview = page.getByRole("dialog", { name: "Review export problems", exact: true });
      await exportReview.waitFor({ timeout: 60_000 });
      await audit(page, `export-review-${scenario}`);
      await escapeTo(page, exportReview, exportMenu);
      await page.evaluate(() => {
        const { workspace, backend } = window.writer;
        const snapshot = workspace.getSnapshot().records.get(workspace.main).snapshot;
        workspace.setBody(workspace.main, `${snapshot.body}\nLocal edit.\n`);
        backend.replica.editElsewhere(workspace.main, { body: `${snapshot.body}\nRemote edit.\n` });
      });
      const compare = page.getByRole("button", { name: "Compare versions", exact: true });
      await compare.click();
      await audit(page, `compare-${scenario}`);
      await escapeTo(page, page.getByRole("dialog", { name: "Compare conflicting versions", exact: true }), compare);
      const home = page.getByRole("button", { name: "Manuscripts", exact: true });
      await home.click();
      await audit(page, `unsaved-changes-${scenario}`);
      await page.evaluate(() => {
        const { workspace } = window.writer;
        const retry = workspace.retrySave.bind(workspace);
        workspace.retrySave = () => new Promise(resolve => { window.finishRetry = () => retry().then(resolve); });
      });
      const retry = page.getByRole("button", { name: "Retry saving", exact: true });
      await retry.click();
      assert.equal(await retry.getAttribute("aria-disabled"), "true");
      assert.ok(await retry.evaluate(el => el === document.activeElement), "Retry keeps focus while saving");
      await page.evaluate(() => window.finishRetry());
      await page.waitForFunction(() => !document.querySelector('.compare-actions [aria-disabled="true"]'));
      assert.ok(await retry.evaluate(el => el === document.activeElement), "A failed retry keeps focus");
      await escapeTo(page, page.getByRole("dialog", { name: "Some changes are not saved", exact: true }), home);
      // The browser-local checkpoint survives a reload. Audit its home row,
      // the editor banner, and the comparison before choosing a version.
      await page.goto(`${base}?demo`);
      await page.locator(".manuscripts > li", { hasText: "Patient Observation" }).locator("[data-path]").click();
      await page.waitForFunction(() => window.writer?.workspace?.getSnapshot().phase === "ready");
      await page.evaluate(async () => {
        const { workspace } = window.writer;
        const snap = workspace.getSnapshot().records.get(workspace.main).snapshot;
        const { DraftStore } = await import("/src/workspace/drafts.ts");
        new DraftStore("demo").write(workspace.main, {
          version: 1, body: "# Recovered local draft\n", frontmatter: snap.frontmatter,
          baseBody: snap.body, baseFrontmatter: snap.record.frontmatter,
          revision: snap.record.revision, updated: new Date().toISOString(),
        });
      });
      await page.goto(`${base}?demo`);
      const drafts = page.getByRole("region", { name: "Unsaved drafts" });
      await drafts.waitFor();
      await audit(page, `offline-drafts-${scenario}`);
      await drafts.getByRole("listitem").filter({ hasText: "Patient Observation" }).getByRole("button", { name: "Review", exact: true }).click();
      const reviewDraft = page.getByRole("button", { name: "Review Patient Observation", exact: true });
      await reviewDraft.waitFor();
      await audit(page, `recovery-banner-${scenario}`);
      await reviewDraft.click();
      await page.getByRole("button", { name: "Restore local draft", exact: true }).waitFor();
      await audit(page, `recovery-dialog-${scenario}`);
      console.log(`PASS ${scenario}: dialogs close with Escape and restore focus`);
    } catch (error) {
      failures++;
      await page.screenshot({ path: `out/a11y-failure-${scenario}.png`, fullPage: true });
      console.error(`FAIL ${scenario}: ${error.stack}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
console.log(`Audited ${audits} Writer surfaces across viewport and theme combinations`);
assert.equal(failures, 0, `${failures} accessibility checks failed`);
