// Loopback-only, real Pandoc conversion and browser downloads; no LAB credentials.
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {chromium} from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:48332/";
const origin = new URL(base).origin;
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname));
await mkdir("out", {recursive: true});
const browser = await chromium.launch({executablePath: process.env.CHROME});
const context = await browser.newContext({viewport: {width: 1280, height: 900}});
await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await context.newPage();
let downloads = 0;
page.on("download", () => downloads++);
try {
  await page.goto(`${base}?demo`);
  await page.locator(".manuscript-title").filter({hasText: "Patient Observation"}).click();
  await page.locator(".cm-content[contenteditable=true]").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.insertText("# Unresolved citation test\n\n[test] Word export with [@bugfix3missing, p. 3].\n");
  await page.getByRole("button", {name: "Export formats", exact: true}).click();
  await page.getByRole("menuitem", {name: /Word/}).click();
  const review = page.getByRole("dialog", {name: "Review export problems", exact: true});
  await review.waitFor({timeout: 120000});
  assert.match(await review.innerText(), /bugfix3missing/);
  assert.equal(downloads, 0);
  await review.getByRole("button", {name: "Cancel and fix problems", exact: true}).click();
  await review.waitFor({state: "hidden"});
  assert.equal(downloads, 0);
  console.log("PASS unresolved citation review and cancellation download nothing");

  await page.getByRole("button", {name: "Export Word", exact: true}).click();
  await review.waitFor();
  // Listen BEFORE the click: the browser may emit download before click() resolves.
  const [download] = await Promise.all([
    page.waitForEvent("download", {timeout: 20000}),
    review.getByRole("button", {name: "Export anyway", exact: true}).click(),
  ]);
  await download.saveAs("out/unresolved-citation.docx");
  assert.equal(await download.failure(), null);
  assert.match(download.suggestedFilename(), /\.docx$/);
  await review.waitFor({state: "hidden"});
  await page.waitForTimeout(800);
  assert.match(await page.getByRole("alert").innerText(), /Exported Word with/);
  assert.equal(downloads, 1);
  console.log("PASS consent downloads DOCX and leaves its warning visible after native close");

  await page.evaluate(() => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = blob => {
      if (blob.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") throw new Error("Controlled download refusal.");
      return original(blob);
    };
  });
  await page.getByRole("button", {name: "Export Word", exact: true}).click();
  await review.waitFor();
  await review.getByRole("button", {name: "Export anyway", exact: true}).click();
  await review.waitFor({state: "hidden"});
  await page.waitForTimeout(800);
  assert.match(await page.getByRole("alert").innerText(), /The file could not be downloaded\. Controlled download refusal\./);
  assert.equal(downloads, 1);
  await page.getByRole("button", {name: "Retry export", exact: true}).waitFor();
  console.log("PASS failed download leaves an actionable error after native close");
} catch (error) {
  await page.screenshot({path: "out/export-review-failure.png"});
  throw error;
} finally { await context.close(); await browser.close(); }
