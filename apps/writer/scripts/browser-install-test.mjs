// Isolated loopback demo, real Writer CSS and install invitation; no LAB credentials.
import assert from "node:assert/strict";
import {chromium} from "playwright";
const base = process.argv[2] ?? "http://127.0.0.1:48332/";
const origin = new URL(base).origin;
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(base).hostname));
const browser = await chromium.launch({executablePath: process.env.CHROME});
const context = await browser.newContext({viewport: {width: 390, height: 844}});
await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const page = await context.newPage();
try {
  await page.goto(`${base}?demo`);
  await page.locator(".manuscript-title").filter({hasText: "Patient Observation"}).click();
  await page.locator(".pane-tabs").waitFor();
  // A controlled browser invitation, never an actual installation.
  await page.evaluate(() => {
    const event = new Event("beforeinstallprompt", {cancelable: true});
    Object.assign(event, {prompt: async () => {}, userChoice: Promise.resolve({outcome: "dismissed"})});
    window.dispatchEvent(event);
  });
  await page.locator(".pwa-install").waitFor({timeout: 35000});
  for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
    await page.setViewportSize({width, height});
    for (const name of ["Sidebar", "Write", "Preview"]) {
      await page.getByRole("navigation", {name: "View", exact: true}).getByRole("button", {name: new RegExp(`^${name}`)}).click();
      const geometry = await page.evaluate(() => {
        const banner = document.querySelector(".pwa-install");
        const prompt = banner.getBoundingClientRect();
        const nav = document.querySelector(".pane-tabs").getBoundingClientRect();
        const withPrompt = document.documentElement.scrollWidth;
        banner.hidden = true;
        const withoutPrompt = document.documentElement.scrollWidth;
        banner.hidden = false;
        return {gap: nav.top - prompt.bottom, top: prompt.top, fits: prompt.left >= 0 && prompt.right <= innerWidth, withPrompt, withoutPrompt};
      });
      assert.ok(geometry.gap >= 8, `${width}px ${name}: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.top >= 0); assert.equal(geometry.fits, true);
      // A zoomed document preview may itself be wider; the invitation must add no overflow.
      assert.equal(geometry.withPrompt, geometry.withoutPrompt, `${width}px ${name}: ${JSON.stringify(geometry)}`);
    }
    console.log(`PASS install invitation leaves all three mode controls reachable at ${width}x${height}`);
  }
  await page.setViewportSize({width: 1280, height: 900});
  assert.equal(await page.locator(".pwa-install").evaluate(e => getComputedStyle(e).bottom), "16px");
  await page.setViewportSize({width: 390, height: 844});
  await page.getByRole("button", {name: "Manuscripts", exact: true}).click();
  assert.equal(await page.locator(".pwa-install").evaluate(e => getComputedStyle(e).bottom), "16px");
  await page.getByRole("button", {name: "Not now", exact: true}).click();
  assert.equal(await page.locator(".pwa-install").count(), 0);
  console.log("PASS desktop/home positioning and dismissal");
} catch (error) {await page.screenshot({path: "out/install-prompt-failure.png"}); throw error;} finally {await context.close(); await browser.close();}
