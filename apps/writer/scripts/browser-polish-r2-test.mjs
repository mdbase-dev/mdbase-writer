import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import axe from "axe-core";
import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:5320/";
const origin = new URL(base).origin;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
mkdirSync("out/polish-r2", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
// Temporary, failure-only diagnostics for the CI-only evaluate error. Avoid
// DEBUG=pw:protocol: serializing every message changes the timing of the race.
const protocol = browser._connection.toImpl(browser)._connection;
const protocolLogger = protocol._protocolLogger;
protocol._protocolLogger = (direction, message) => {
  if (direction === "receive" && message.error) console.error("Chromium protocol error:", JSON.stringify(message.error));
  protocolLogger(direction, message);
};
const results = [];
try {
  for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"]) for (const reducedMotion of ["no-preference", "reduce"]) {
    const name = `${width}-${colorScheme}-${reducedMotion}`;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme, reducedMotion });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const navigation = [];
    page.on("request", request => { if (request.isNavigationRequest()) navigation.push({ type: "document", url: request.url() }); });
    page.on("websocket", socket => socket.on("framereceived", event => {
      if (typeof event.payload === "string" && event.payload.includes("full-reload")) navigation.push({ type: "hmr", payload: event.payload });
    }));
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.goto(`${base}?demo`);
      await page.locator(".manuscript-row").first().waitFor();
      await page.evaluate(async () => { window.nativeFixture = await (await import("/scripts/browser-a11y-fixture.tsx")).mountNative(); });
      await page.locator('.manuscript-row[data-path="writing/main.md"]').click();
      await page.locator(".cm-content").waitFor();
      if (width === 390) await page.getByRole("button", { name: "Preview", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".preview-pages canvas.page")?.dataset.version, null, { timeout: 60000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Preview-selected page overflow");
      if (width === 390) await page.getByRole("button", { name: "Write", exact: true }).click();
      assert.equal(await page.getByRole("main").count(), 1);
      assert.equal(await page.getByRole("heading", { level: 1, name: "Original manuscript", exact: true }).count(), 1);
      await page.evaluate(axe.source);
      const semanticViolations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ["landmark-one-main", "page-has-heading-one", "region"] })).violations);
      assert.deepEqual(semanticViolations.map(violation => violation.id), []);
      if (width === 390) {
        const targets = await page.locator('.bar-back, .bar button[aria-label="Insert"], .bar button[aria-label="Settings"], .bar button[aria-label="More"]').evaluateAll(elements => elements.map(element => ({ label: element.getAttribute("aria-label"), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
        assert.equal(targets.length, 4);
        assert.ok(targets.every(target => target.width >= 44 && target.height >= 44), JSON.stringify(targets));
      }
      await page.evaluate(() => window.nativeFixture.replica().setOnline(false));
      await context.setOffline(true);
      await page.locator(".cm-content").fill("Offline draft retained on this device.\n");
      await page.waitForFunction(() => window.writer.workspace.getSnapshot().records.get(window.writer.workspace.main).snapshot.state === "saved_on_device");
      const notice = page.locator(`.bar .mdbase-save-notice.${width === 390 ? "is-short" : "is-long"}`);
      assert.match(await notice.innerText(), /Offline.*on.*device.*sync/i);
      assert.equal(await notice.isVisible(), true);
      assert.equal(await page.locator(".bar .mdbase-save-notice.is-saved:visible").count(), 0);
      await page.screenshot({ path: `out/polish-r2/${name}-offline.png` });
      await context.setOffline(false);
      await page.evaluate(() => { window.nativeFixture.replica().setOnline(true); window.nativeFixture.replica().confirmAll(); });
      await page.waitForFunction(() => window.writer.workspace.getSnapshot().records.get(window.writer.workspace.main).snapshot.state === "saved");
      await page.evaluate(() => { window.nativeHold = window.nativeFixture.replica().hold("writing/main.md"); });
      await page.getByRole("alert").filter({ hasText: "not available for comparison" }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Compare versions", exact: true }).count(), 0);
      assert.equal(await page.getByRole("button", { name: "Download local drafts", exact: true }).isVisible(), true);
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Download local drafts", exact: true }).click();
      const draftDownload = await download;
      await draftDownload.saveAs(`out/polish-r2/${name}-${draftDownload.suggestedFilename()}`);
      await page.screenshot({ path: `out/polish-r2/${name}-hold.png` });
      await page.evaluate(async () => { const client = window.nativeFixture.client(); const result = await client.save(client.resolveHold(window.nativeHold, "keep_mine")); if (result.outcome !== "confirmed") throw new Error("Fixture hold did not resolve"); });
      await page.waitForFunction(() => window.writer.workspace.getSnapshot().records.get(window.writer.workspace.main).snapshot.state === "saved");
      await page.evaluate(() => { window.writer.workspace.setBody("writing/main.md", "Local concurrent edit\n"); window.nativeFixture.replica().editElsewhere("writing/main.md", { body: "Collection concurrent edit\n" }); });
      await page.getByRole("button", { name: "Compare versions", exact: true }).click();
      const comparison = page.getByRole("dialog", { name: "Compare conflicting versions" });
      await comparison.waitFor();
      assert.match(await comparison.innerText(), /Collection concurrent edit/);
      await comparison.getByRole("textbox", { name: /Merged Markdown/ }).fill("Deliberately merged native draft\n");
      await comparison.getByRole("button", { name: "Save merged version", exact: true }).click();
      await page.waitForFunction(() => { const snapshot = window.writer.workspace.getSnapshot().records.get(window.writer.workspace.main).snapshot; return snapshot.state === "saved" && snapshot.body === "Deliberately merged native draft\n"; });
      assert.equal(await page.evaluate(async () => (await window.nativeFixture.client().get({ path: "writing/main.md" }, { body: true })).body), "Deliberately merged native draft\n");
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `out/polish-r2/${name}-merged.png` });
      results.push({ name, ok: true });
      console.log(`ok native status, protected hold, download, merge and semantics ${name}`);
    } catch (error) {
      console.error("Failure navigation evidence:", JSON.stringify({ name, navigation }));
      console.error("Failure document evidence:", await page.evaluate(() => ({ url: location.href, fixture: !!window.nativeFixture, state: window.writer?.workspace?.getSnapshot().records.get(window.writer.workspace.main)?.snapshot.state })).catch(failure => failure.message));
      await page.screenshot({ path: `out/polish-r2/${name}-failure.png` });
      throw error;
    } finally {
      await context.setOffline(false);
      await page.evaluate(() => window.nativeFixture?.close()).catch(() => {});
      await context.close();
    }
  }
} finally {
  writeFileSync("out/polish-r2/matrix.json", JSON.stringify(results, null, 2));
  await browser.close();
}
