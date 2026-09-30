// Usage: node scripts/collection-picker-test.mjs [Vite dev URL]
// Uses a mock session only; never connects to a real collection.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://127.0.0.1:5320/";
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/home/calluma/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell" });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  await page.goto(`${base}?demo`);
  await page.getByRole("heading", { name: "Manuscripts" }).waitFor();
  // Demo stays a plain collection label.
  assert.equal(await page.getByRole("button", { name: /Switch collection/ }).count(), 0);
  await page.evaluate(async () => {
    const { mount } = await import("/scripts/collection-picker-fixture.tsx");
    window.pickerTest = mount();
  });
  const trigger = page.getByRole("button", { name: "Switch collection: Current" });
  const menu = page.getByRole("menu", { name: "Switch collection" });
  await trigger.click();
  await menu.waitFor();
  // The current collection comes first, checked, under its fresh name, and has focus.
  const current = menu.getByRole("menuitemradio", { name: /Current/ });
  assert.equal(await current.getAttribute("aria-checked"), "true");
  assert.equal(await menu.getByText("Cached name").count(), 0);
  assert.deepEqual(await menu.getByRole("menuitemradio").allTextContents(), ["CurrentOpen now · Hosted by mdbase", "OtherOn your computer"]);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-checked")), "true");
  await current.click();
  await menu.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.pickerTest.calls), []);
  await trigger.click();
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Switch collection: Current");
  await trigger.click();
  await page.evaluate(() => { window.pickerTest.fail = true; });
  await menu.getByRole("menuitemradio", { name: "Other" }).click();
  await menu.getByRole("alert").filter({ hasText: "Selection failed" }).waitFor();
  await page.evaluate(() => { window.pickerTest.fail = false; });
  await menu.getByRole("menuitemradio", { name: "Other" }).click();
  await menu.waitFor({ state: "hidden" });
  await trigger.click();
  await menu.getByRole("menuitem", { name: "Connect another collection…" }).click();
  await menu.getByRole("menuitem", { name: "Waiting for mdbase connect…" }).waitFor();
  assert.equal(await menu.getByRole("menuitemradio", { name: "Other" }).isDisabled(), true);
  await page.evaluate(() => window.pickerTest.finish());
  await menu.getByRole("alert").filter({ hasText: "Authorization cancelled" }).waitFor();
  await page.keyboard.press("Escape");
  await menu.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.pickerTest.calls), [
    ["select", "other"], ["select", "other"],
    ["authorize", "choose", { presentation: "popup", timeoutMs: 600000 }],
  ]);
  assert.deepEqual(errors, []);
  console.log("ok collection picker: demo label, current collection first, Escape, switching, errors, popup authorization");
} finally {
  await browser.close();
}
