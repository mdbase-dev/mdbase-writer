import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

// Disposable in-memory demo only. Block all non-local authority/compiler traffic.
const base = process.env.BASE ?? "http://127.0.0.1:19400/";
const origin = new URL(base).origin;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
await mkdir("out/i18n", { recursive: true });
const browser = await chromium.launch({ headless: true });
const localeNames = { en: "English", it: "Italiano", ja: "日本語", de: "Deutsch", zh: "简体中文" };
async function openLanguage(page) {
  await page.locator(".home, .workspace").waitFor();
  if (await page.locator(".home").count()) await page.locator('.home [data-path][data-path="manuscripts/slow-change.md"]').click();
  await page.locator(".cm-content").waitFor();
  if (!await page.locator(".settings-sheet").count()) await page.keyboard.press("Control+,");
  await page.locator(".interface-language [role=combobox]").waitFor();
}
async function chooseLanguage(page, locale) {
  await openLanguage(page);
  await page.locator(".interface-language [role=combobox]").click();
  await page.getByRole("option", { name: localeNames[locale], exact: true }).click();
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "en-US", recordVideo: { dir: "out/i18n/recordings", size: { width: 1440, height: 960 } } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(new URL("?demo", base).href);
  const picker = page.locator(".interface-language [role=combobox]:visible");
  await page.locator(".manuscript-row").filter({ hasText: "Patient Observation" }).waitFor();
  assert.equal(await page.locator("html").getAttribute("lang"), "en");

  assert.equal(await page.locator(".topbar .interface-language").count(), 0);
  await openLanguage(page);
  await picker.click();
  assert.equal(await page.getByRole("option").count(), 10);
  assert.equal(await page.getByRole("option", { name: "Italiano", exact: true }).textContent(), "Italiano");
  await page.getByRole("option", { name: "Italiano", exact: true }).click();
  await page.waitForFunction(() => document.documentElement.lang === "it");
  assert.equal(await page.evaluate(() => localStorage.getItem("mdbase-writer:interface-locale")), "it");
  const italianFormatting = await page.evaluate(async () => {
    const { plural } = await import("/src/ui/records.ts");
    const { formatDate, formatNumber, formatRelative } = await import("/src/i18n/presentation.ts");
    return {
      words: [0, 1, 2].map(n => plural(n, "word")),
      comments: [0, 1, 2].map(n => plural(n, "open comment")),
      date: formatDate(new Date(2026, 9, 23), { dateStyle: "long" }),
      number: formatNumber(12345.5),
      relative: formatRelative(-1, "day"),
    };
  });
  assert.deepEqual(italianFormatting, {
    words: ["0 parole", "1 parola", "2 parole"],
    comments: ["0 commenti aperti", "1 commento aperto", "2 commenti aperti"],
    date: "23 ottobre 2026", number: "12.345,5", relative: "ieri",
  });
  await page.keyboard.press("Escape");
  await page.locator(".bar-back").click();
  await page.locator(".home").waitFor();
  await page.screenshot({ path: "out/i18n/italian-home.png", fullPage: true });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === "it");
  await openLanguage(page);
  assert.match(await picker.innerText(), /Italiano/);

  await chooseLanguage(page, "ja");
  await page.waitForFunction(() => document.documentElement.lang === "ja");
  assert.equal(await page.evaluate(() => localStorage.getItem("mdbase-writer:interface-locale")), "ja");
  await page.keyboard.press("Escape");
  await page.locator(".bar-back").click();
  await page.locator(".home").waitFor();
  await page.screenshot({ path: "out/i18n/japanese-home.png", fullPage: true });
  await page.locator('.home [data-path][data-path="manuscripts/slow-change.md"]').click();
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
  await chooseLanguage(page, "de");
  await page.waitForFunction(() => document.documentElement.lang === "de");
  assert.equal(await manuscriptSource(), before, "language switching must not edit the manuscript");
  await page.screenshot({ path: "out/i18n/german-settings.png", fullPage: true });
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === "de");
  await page.locator(".cm-content").waitFor();
  await page.keyboard.press("Control+,");
  await page.locator(".settings-sheet").waitFor();
  assert.match(await picker.innerText(), /Deutsch/);
  await page.setViewportSize({ width: 390, height: 844 });
  await picker.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "out/i18n/narrow-language-control.png", fullPage: true });
  const bounds = await picker.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844, "language setting remains reachable on a narrow viewport");
  // Chinese is an authored product catalogue, not just a translated editor phrase set.
  await chooseLanguage(page, "zh");
  await page.waitForFunction(() => document.documentElement.lang === "zh");
  assert.match(await picker.getAttribute("aria-label"), /[\u3400-\u9fff]/);
  assert.equal(await manuscriptSource(), before);
  await page.screenshot({ path: "out/i18n/chinese-settings-narrow.png", fullPage: true });
  await chooseLanguage(page, "it");
  await page.waitForFunction(() => document.documentElement.lang === "it");
  assert.equal(await manuscriptSource(), before);
  await page.screenshot({ path: "out/i18n/italian-settings-narrow.png", fullPage: true });
  await page.keyboard.press("Escape");
  await editor.click();
  await page.keyboard.press("Control+f");
  await page.waitForFunction(() => document.querySelector('.cm-search input[name="search"]')?.getAttribute("placeholder") === "Trova");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+,");
  await chooseLanguage(page, "zh");
  await page.waitForFunction(() => document.documentElement.lang === "zh");
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
  await openLanguage(failedPage);
  const failedPicker = failedPage.locator(".interface-language [role=combobox]");
  await failedPicker.waitFor();
  await chooseLanguage(failedPage, "de");
  await failedPage.locator(".interface-language-error").waitFor();
  assert.equal(await failedPage.locator("html").getAttribute("lang"), "en");
  assert.notEqual(await failedPage.evaluate(() => localStorage.getItem("mdbase-writer:interface-locale")), "de");
  await chooseLanguage(failedPage, "ja");
  await failedPage.waitForFunction(() => document.documentElement.lang === "ja");
  assert.equal(await failedPage.locator(".interface-language-error").count(), 0, "a successful retry clears the prior error");
  await failure.close();
  // Browser/OS negotiation must also discover Italian before any explicit choice.
  const negotiated = await browser.newContext({ locale: "it-IT" });
  const negotiatedPage = await negotiated.newPage();
  await negotiatedPage.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await negotiatedPage.goto(new URL("?demo", base).href);
  await negotiatedPage.waitForFunction(() => document.documentElement.lang === "it");
  await openLanguage(negotiatedPage);
  assert.match(await negotiatedPage.locator(".interface-language [role=combobox]").innerText(), /Italiano/);
  await negotiated.close();
  console.log("i18n browser: ten locales/Italiano picker, Italian negotiation/persistence, plurals/date/number/relative time and CodeMirror, synchronous English, Japanese CodeMirror, unchanged manuscript, narrow picker, authored Chinese settings and chunk-failure retention passed.");
} finally {
  await browser.close();
}
