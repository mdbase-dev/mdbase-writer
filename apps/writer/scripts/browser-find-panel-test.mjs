// Isolated loopback demo and real CodeMirror/CSS; no LAB credentials.
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
    const geometry = await panel.locator("label").evaluateAll(labels => labels.map(label => {
      const input = label.querySelector("input");
      const text = [...label.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
      const range = document.createRange();
      range.selectNodeContents(text);
      const box = input.getBoundingClientRect(), caption = range.getBoundingClientRect(), target = label.getBoundingClientRect();
      return {text: label.innerText, width: box.width, gap: caption.left - box.right, center: Math.abs((caption.top + caption.bottom - box.top - box.bottom) / 2), targetHeight: target.height};
    }));
    assert.equal(geometry.length, 3);
    for (const option of geometry) {
      assert.ok(option.width <= 24, `${width}px stretched checkbox: ${JSON.stringify(option)}`);
      assert.ok(option.gap >= 0 && option.gap <= 12, `${width}px separated label: ${JSON.stringify(option)}`);
      assert.ok(option.center <= 6, `${width}px separate rows: ${JSON.stringify(option)}`);
      if (width < 900) assert.ok(option.targetHeight >= 44, `${width}px small touch label: ${JSON.stringify(option)}`);
    }
    for (const name of ["match case", "regexp", "by word"]) {
      const checkbox = panel.getByRole("checkbox", {name, exact: true});
      const before = await checkbox.isChecked();
      await panel.locator("label").filter({hasText: name}).click();
      assert.equal(await checkbox.isChecked(), !before);
      await checkbox.focus();
      await page.keyboard.press("Space");
      assert.equal(await checkbox.isChecked(), before);
    }
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1);
    await page.screenshot({path: `out/find-panel-${width}.png`});
    console.log(`PASS ${width}px adjacent labels, label/keyboard toggles and panel fits`);
  }
} catch (error) {
  await page.screenshot({path: "out/find-panel-failure.png"});
  throw error;
} finally { await context.close(); await browser.close(); }
