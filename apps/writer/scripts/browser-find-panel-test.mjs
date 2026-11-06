// Isolated loopback demo and real CodeMirror/CSS; no LAB credentials.
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
import {chromium} from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:5320/";
const origin = new URL(base).origin;
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname));
await mkdir("out", {recursive: true});
const browser = await chromium.launch({executablePath: process.env.CHROME});
const context = await browser.newContext({viewport: {width: 1280, height: 900}});
await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await context.newPage();
try {
  await page.goto(`${base}?demo`);
  await page.locator(".manuscript-title").filter({hasText: "Patient Observation"}).click();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({width, height: width === 1280 ? 900 : 844});
    if (width < 900) await page.getByRole("navigation", {name: "View", exact: true}).getByRole("button", {name: /Write/}).click();
    const panel = page.locator(".cm-search");
    if (!await panel.isVisible()) {
      await page.locator(".cm-content[contenteditable=true]").click();
      await page.keyboard.press("Control+f");
    }
    await panel.waitFor();
    await page.keyboard.type("Darwin");
    assert.equal(await panel.getByRole("textbox", {name: "Find", exact: true}).inputValue(), "Darwin");
    assert.ok(await panel.evaluate(element => element.getBoundingClientRect().height < 62));
    assert.equal(await panel.locator(".cm-button,.cm-textfield").count(), 0);
    assert.equal(await panel.locator('button[name="close"]').evaluate(element => getComputedStyle(element).position), "static");
    assert.ok(await panel.evaluate(element => element.querySelector("summary").getBoundingClientRect().right <= element.querySelector('[name="close"]').getBoundingClientRect().left));
    await panel.locator("summary").click();
    for (const name of ["Match case", "Regular expression", "Whole words"]) {
      const option = panel.getByRole("button", {name, exact: true});
      const before = await option.getAttribute("aria-pressed");
      await option.click();
      assert.notEqual(await option.getAttribute("aria-pressed"), before);
      await option.focus();
      await page.keyboard.press("Space");
      assert.equal(await option.getAttribute("aria-pressed"), before);
    }
    const options = await panel.locator(".find-options").boundingBox();
    assert.ok(options.x >= 0 && options.x + options.width <= width + 1);
    await panel.locator("summary").click();
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await page.screenshot({path: `out/find-panel-${width}.png`});
    console.log(`PASS ${width}px single-row Find, named pointer/keyboard toggles and anchored options fit`);
    await page.keyboard.press("Escape");
  }
} catch (error) {
  await page.screenshot({path: "out/find-panel-failure.png"});
  throw error;
} finally { await context.close(); await browser.close(); }
