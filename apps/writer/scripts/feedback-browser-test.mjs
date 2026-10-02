// Demo-data acceptance only. Intercepts every feedback POST; never sends mail.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const origin = process.env.WRITER_FEEDBACK_TEST_ORIGIN ?? "http://127.0.0.1:8892";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(origin)) throw new Error("Feedback acceptance requires a loopback preview.");
const browser = await chromium.launch();
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const posts = [];
    await context.route("**/v1/feedback", async (route) => {
      posts.push(route.request().postDataJSON());
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });
    await page.addInitScript(() => {
      window.feedbackCaptures = 0;
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: { getDisplayMedia: () => { window.feedbackCaptures++; return Promise.reject(new DOMException("Cancelled", "NotAllowedError")); } },
      });
    });
    await page.goto(`${origin}/?demo`);
    await page.locator(".manuscript-row", { hasText: "Small Agents, Large Effects" }).click();
    await page.waitForFunction(() => window.writer?.workspace?.getSnapshot().phase === "ready");
    // A user-visible compiler failure, not a Markdown/typesetting diagnostic.
    await page.evaluate(() => window.writer.workspace.update({ previewProblem: "PRIVATE compiler exception /private/manuscript.md" }));
    const trigger = page.locator(".topbar").getByRole("button", { name: "Send feedback", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "Send feedback", exact: true });
    const message = dialog.getByLabel("What happened?");
    assert.equal(await message.evaluate((element) => document.activeElement === element), true);
    assert.equal(await dialog.locator("details").evaluate((element) => element.open), false);
    assert.equal(await page.evaluate(() => window.feedbackCaptures), 0);
    await message.fill("A private sample draft");
    await page.screenshot({ path: `/tmp/shared-feedback-writer-form-${width}.png` });
    await message.press("Control+k");
    await message.press("F8");
    assert.equal(await page.locator("dialog[open]").count(), 1);
    assert.equal(await message.evaluate((element) => document.activeElement === element), true);
    await message.press("Escape");
    assert.equal(await dialog.isVisible(), false);
    assert.equal(await trigger.evaluate((element) => document.activeElement === element), true);
    await trigger.click();
    assert.equal(await message.inputValue(), "A private sample draft");
    await dialog.getByText("What gets sent", { exact: true }).click();
    await dialog.getByLabel("Include technical diagnostics", { exact: true }).check();
    const preview = await dialog.locator("pre").last().innerText();
    assert.ok(preview.includes("preview_failed"));
    assert.ok(!preview.includes("PRIVATE"));
    await dialog.getByRole("button", { name: "Send feedback", exact: true }).click();
    const thanks = dialog.getByRole("heading", { name: "Thanks for the report." });
    await thanks.waitFor();
    assert.equal(await thanks.evaluate((element) => document.activeElement === element), true);
    assert.equal(posts.length, 1);
    const payload = posts[0];
    assert.equal(payload.schema_version, 2);
    assert.equal(payload.application.product, "mdbase writer");
    assert.equal(payload.application.source_view, "manuscript");
    assert.ok(payload.diagnostics.events.some((event) => event.code === "preview_failed"));
    assert.ok(!JSON.stringify(payload).includes("PRIVATE"));
    for (const key of ["context", "screenshot", "reply_email"]) assert.equal(payload[key], undefined);
    await page.screenshot({ path: `/tmp/shared-feedback-writer-${width}.png` });
    await context.close();
  }
  console.log("Writer feedback desktop/mobile acceptance passed; all delivery intercepted.");
} finally {
  await browser.close();
}
