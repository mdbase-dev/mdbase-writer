import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Disposable in-memory demo only. Block all non-local authority/compiler traffic.
const base = process.env.BASE ?? "http://127.0.0.1:19400/";
const origin = new URL(base).origin;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
await mkdir("out/i18n", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "en-US", recordVideo: { dir: "out/i18n/recordings", size: { width: 1440, height: 960 } } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(new URL("?demo", base).href);
  const picker = page.locator(".interface-language select:visible");
  await picker.waitFor();
  await page.locator(".manuscript-row").filter({ hasText: "Patient Observation" }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");

  await picker.selectOption("ja");
  await page.waitForFunction(() => document.documentElement.lang === "ja");
  assert.equal(await page.evaluate(() => localStorage.getItem("mdbase-writer:interface-locale")), "ja");
  await page.locator(".manuscript-row").filter({ hasText: "Patient Observation" }).click();
  const editor = page.locator(".cm-content");
  await editor.waitFor();
  const manuscriptSource = () => page.evaluate(() => {
    const workspace = window.writer.workspace;
    return workspace.getSnapshot().records.get(workspace.main).snapshot.body;
  });
  const before = await manuscriptSource();
  await editor.click();
  await page.keyboard.press("Control+f");
  await page.locator(".cm-search").waitFor();
  await page.waitForFunction(() => document.querySelector('.cm-search input[name="search"]')?.getAttribute("placeholder") === "検索");
  await page.screenshot({ path: "out/i18n/japanese-editor.png", fullPage: true });

  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  await page.locator(".settings-sheet").waitFor();
  await picker.selectOption("de");
  await page.waitForFunction(() => document.documentElement.lang === "de");
  assert.equal(await manuscriptSource(), before, "language switching must not edit the manuscript");
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === "de");
  await page.locator(".cm-content").waitFor();
  await page.keyboard.press("Control+,");
  await page.locator(".settings-sheet").waitFor();
  assert.equal(await picker.inputValue(), "de");
  await page.setViewportSize({ width: 390, height: 844 });
  await picker.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "out/i18n/narrow-language-control.png", fullPage: true });
  const bounds = await picker.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844, "language setting remains reachable on a narrow viewport");
  // Chinese is an authored product catalogue, not just a translated editor phrase set.
  await picker.selectOption("zh");
  await page.waitForFunction(() => document.documentElement.lang === "zh");
  assert.match(await picker.getAttribute("aria-label"), /[\u3400-\u9fff]/);
  assert.equal(await manuscriptSource(), before);
  await page.screenshot({ path: "out/i18n/chinese-settings-narrow.png", fullPage: true });
  // Menu descriptors must not cache labels from the previous interface language.
  await page.keyboard.press("Escape");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\n/");
  await page.locator(".cm-tooltip-autocomplete").waitFor();
  const insertLabels = await page.locator(".cm-tooltip-autocomplete li").allTextContents();
  assert.ok(insertLabels.some(label => label.includes("引文")), "slash commands update after a locale switch");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  assert.equal(await manuscriptSource(), before, "the test restores its disposable slash-menu probe");
  assert.deepEqual(errors, []);
  await context.close();

  // A fresh context avoids an already cached target import.
  const failure = await browser.newContext({ locale: "en-US" });
  const failedPage = await failure.newPage();
  await failedPage.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || /\/locales\/de\/messages\.json/.test(url.pathname)) return route.abort();
    return route.continue();
  });
  await failedPage.goto(new URL("?demo", base).href);
  const failedPicker = failedPage.locator(".interface-language select");
  await failedPicker.waitFor();
  await failedPicker.selectOption("de");
  await failedPage.locator(".interface-language-error").waitFor();
  assert.equal(await failedPage.locator("html").getAttribute("lang"), "en");
  assert.notEqual(await failedPage.evaluate(() => localStorage.getItem("mdbase-writer:interface-locale")), "de");
  await failedPicker.selectOption("ja");
  await failedPage.waitForFunction(() => document.documentElement.lang === "ja");
  assert.equal(await failedPage.locator(".interface-language-error").count(), 0, "a successful retry clears the prior error");
  await failure.close();
  console.log("i18n browser: synchronous English, selection/persistence, Japanese CodeMirror, unchanged manuscript, narrow picker, authored Chinese settings and chunk-failure retention passed. Product-catalogue German/Japanese layout review still requires authored translations.");
} finally {
  await browser.close();
}
