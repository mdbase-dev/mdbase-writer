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

async function audit(page, name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(document.getAnimations().filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity
    ).map(animation => animation.finished.catch(() => {})));
  });
  await page.evaluate(axe.source);
  const results = await page.evaluate(() => window.axe.run(document, {
    // This speech-input rule is opt-in in axe, including the production sweep.
    rules: { "label-content-name-mismatch": { enabled: true } },
  }));
  await writeFile(`out/a11y-${name}.json`, JSON.stringify(results.violations, null, 2));
  const serious = results.violations.filter(({ impact }) => impact === "serious" || impact === "critical");
  if (serious.length) {
    failures++;
    await page.screenshot({ path: `out/a11y-${name}.png`, fullPage: true });
    console.error(`FAIL ${name}: ${JSON.stringify(serious.map(v => ({ id: v.id, nodes: v.nodes.map(n => n.target) })))}`);
  } else console.log(`PASS ${name}: no serious or critical axe violations`);
}

async function escapeTo(page, dialog, opener) {
  await dialog.waitFor();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.ok(await opener.evaluate(el => el === document.activeElement), "Escape must return focus to the opener");
}

try {
  for (const width of [375, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 812 }, colorScheme: "light" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    try {
      await page.goto(`${base}?demo`);
      await page.getByRole("heading", { name: "Manuscripts", exact: true }).waitFor();
      await page.evaluate(async () => (await import("/scripts/browser-a11y-fixture.tsx")).mountSignIn());
      await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
      await audit(page, `signin-${width}`);

      await page.goto(`${base}?demo`);
      await page.getByRole("heading", { name: "Manuscripts", exact: true }).waitFor();
      await audit(page, `home-${width}`);
      const create = page.getByRole("button", { name: "New manuscript", exact: true });
      await create.click();
      await audit(page, `new-manuscript-${width}`);
      await escapeTo(page, page.getByRole("dialog", { name: "New manuscript", exact: true }), create);

      await page.locator(".manuscript-row", { hasText: "Small Agents, Large Effects" }).click();
      await page.waitForFunction(() => {
        const snap = window.writer?.workspace?.getSnapshot();
        return snap?.artifact && !snap.compiling && Number(document.querySelector(".preview-pages")?.dataset.renderedRevision) === snap.artifactRevision;
      }, null, { timeout: 60_000 });
      await audit(page, `editor-${width}`);
      if (width < 900) {
        await page.getByRole("navigation", { name: "View", exact: true }).getByRole("button", { name: /Preview/ }).click();
        await audit(page, `preview-${width}`);
        await page.getByRole("navigation", { name: "View", exact: true }).getByRole("button", { name: /Sidebar/ }).click();
      }
      for (const name of ["Sources", "Comments"]) {
        await page.getByRole("tab", { name: new RegExp(name) }).click();
        if (name === "Comments") await page.waitForFunction(() => window.writer.workspace.getSnapshot().commentsLoad.phase === "ready");
        await audit(page, `${name.toLowerCase()}-${width}`);
      }
      await page.getByRole("button", { name: "Second panel", exact: true }).click();
      await audit(page, `split-sidebar-${width}`);
      await page.getByRole("button", { name: "Close the lower panel", exact: true }).click();
      if (width < 900) await page.getByRole("navigation", { name: "View", exact: true }).getByRole("button", { name: /Write/ }).click();
      const settings = page.getByRole("button", { name: "Settings", exact: true });
      await settings.click();
      await audit(page, `settings-${width}`);
      await escapeTo(page, page.getByRole("dialog", { name: "Manuscript settings", exact: true }), settings);

      const more = page.getByRole("button", { name: "More", exact: true });
      for (const name of ["Keyboard shortcuts", "Commands"]) {
        await more.click();
        await page.getByRole("menuitem", { name: new RegExp(`^${name}`) }).click();
        await audit(page, `${name.toLowerCase().replaceAll(" ", "-")}-${width}`);
        await escapeTo(page, page.getByRole("dialog", { name: name === "Commands" ? "Writer commands" : name, exact: true }), more);
      }
      await page.evaluate(() => {
        const { workspace } = window.writer;
        workspace.setBody(workspace.main, "# Export check\n\nMissing citation [@a11y-missing].\n");
      });
      let exportOpener;
      if (width < 900) {
        await more.click();
        await page.getByRole("menuitem", { name: "PDF", exact: true }).click();
        exportOpener = more;
      } else {
        exportOpener = page.getByRole("button", { name: "Export PDF", exact: true });
        await exportOpener.click();
      }
      const exportReview = page.getByRole("dialog", { name: "Review export problems", exact: true });
      await exportReview.waitFor({ timeout: 60_000 });
      await audit(page, `export-review-${width}`);
      await escapeTo(page, exportReview, exportOpener);
      await page.evaluate(() => {
        const { workspace, backend } = window.writer;
        const snapshot = workspace.getSnapshot().records.get(workspace.main).snapshot;
        workspace.setBody(workspace.main, `${snapshot.body}\nLocal edit.\n`);
        backend.replica.editElsewhere(workspace.main, { body: `${snapshot.body}\nRemote edit.\n` });
      });
      const compare = page.getByRole("button", { name: "Compare versions", exact: true });
      await compare.click();
      await audit(page, `compare-${width}`);
      await escapeTo(page, page.getByRole("dialog", { name: "Compare conflicting versions", exact: true }), compare);
      const home = page.getByRole("button", { name: "Manuscripts", exact: true });
      await home.click();
      await audit(page, `unsaved-changes-${width}`);
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
      console.log(`PASS ${width}px: dialogs close with Escape and restore focus`);
    } catch (error) {
      failures++;
      await page.screenshot({ path: `out/a11y-failure-${width}.png`, fullPage: true });
      console.error(`FAIL ${width}px: ${error.stack}`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
assert.equal(failures, 0, `${failures} accessibility checks failed`);
