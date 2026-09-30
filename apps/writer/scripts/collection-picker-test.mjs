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
  const dialog = page.getByRole("dialog", { name: "Choose a collection" });
  await trigger.click();
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("button", { name: /Current collection/ }).count(), 1);
  assert.equal(await dialog.getByText("Cached name").count(), 0);
  await dialog.getByRole("button", { name: /Current collection/ }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.pickerTest.calls), []);
  await trigger.click();
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  await trigger.click();
  await page.evaluate(() => { window.pickerTest.fail = true; });
  await dialog.getByRole("button", { name: "Other", exact: true }).click();
  await dialog.getByRole("alert").filter({ hasText: "Selection failed" }).waitFor();
  await page.evaluate(() => { window.pickerTest.fail = false; });
  await dialog.getByRole("button", { name: "Other", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await trigger.click();
  await dialog.getByRole("button", { name: "Connect another collection" }).click();
  await dialog.getByRole("button", { name: "Waiting for mdbase connect…" }).waitFor();
  assert.equal(await dialog.getByRole("button", { name: "Other", exact: true }).isDisabled(), true);
  await page.evaluate(() => window.pickerTest.finish());
  await dialog.getByRole("alert").filter({ hasText: "Authorization cancelled" }).waitFor();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.pickerTest.calls), [
    ["select", "other"], ["select", "other"],
    ["authorize", "choose", { presentation: "popup", timeoutMs: 600000 }],
  ]);
  assert.deepEqual(errors, []);
  console.log("ok collection picker: demo label, current collection, Escape, switching, errors, popup authorization");
} finally {
  await browser.close();
}
