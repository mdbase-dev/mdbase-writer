import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:5320/";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
mkdirSync("out/polish-r8", { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const results = [];
async function scenario(name, options, run) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(`${base}?demo`);
    await page.locator(".home [data-path]").first().waitFor();
    await page.evaluate(async () => { window.roundEight = await (await import("/scripts/round-eight-fixture.tsx")).mount(); });
    await page.locator("#round-eight .cm-content").waitFor();
    await page.waitForFunction(() => document.querySelector("#round-eight .workspace[data-ready]"));
    const measurements = await run(page, page.locator("#round-eight"));
    assert.deepEqual(errors, []);
    results.push({ name, pass: true, measurements });
    console.log(`PASS ${name} ${JSON.stringify(measurements)}`);
  } catch (error) {
    results.push({ name, pass: false, error: error.message });
    console.error(`FAIL ${name}: ${error.message}`);
    await page.screenshot({ path: `out/polish-r8/${name}.png` });
  } finally { await context.close(); }
}
try {
  for (const colorScheme of ["light", "dark"]) {
    for (const width of [1440, 1042, 390]) await scenario(`sync-${width}-${colorScheme}`, { colorScheme, viewport: { width, height: 900 } }, async (page, host) => {
      const geometry = () => host.evaluate(element => ({ width: document.documentElement.scrollWidth, bar: element.querySelector(".topbar").getBoundingClientRect().height, prose: element.querySelector(".cm-content").getBoundingClientRect().top }));
      const before = await geometry();
      await page.evaluate(() => window.roundEight.notice("sync_delayed"));
      const download = host.getByRole("button", { name: "Download local drafts", exact: true });
      await download.waitFor();
      const after = await geometry();
      assert.equal(after.width, width, "Delayed status must not introduce horizontal page overflow");
      assert.equal(after.bar, before.bar, "Delayed status must keep reserved chrome height");
      assert.equal(after.prose, before.prose, "Delayed status must not move the prose");
      assert.ok(!await host.innerText().then(text => text.includes("Stay online")), "No stale shared instruction");
      const exposed = await host.locator('.save-slot [aria-live="polite"], .bar [role="status"]').evaluateAll(elements => elements.filter(element => element.checkVisibility()).map(element => element.textContent));
      assert.equal(exposed.length, 1, `One status announcement, not ${JSON.stringify(exposed)}`);
      const box = await download.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.height <= 24, JSON.stringify(box));
      assert.equal(await download.evaluate(element => document.elementFromPoint(element.getBoundingClientRect().x + element.clientWidth / 2, element.getBoundingClientRect().y + element.clientHeight / 2) === element), true);
      const downloaded = page.waitForEvent("download");
      await download.click();
      assert.match((await downloaded).suggestedFilename(), /local drafts.*\.zip$/);
      await page.screenshot({ path: `out/polish-r8/sync-${width}-${colorScheme}.png` });
      return { before, after, exposed, download: box };
    });
    await scenario(`hover-${colorScheme}`, { colorScheme }, async (page, host) => {
      await page.waitForFunction(() => !window.roundEight.workspace.getSnapshot().compiling);
      const primary = host.locator('.split-button .is-primary').first();
      const before = await primary.evaluate(element => getComputedStyle(element).backgroundColor);
      await primary.hover();
      await primary.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
      const after = await primary.evaluate(element => getComputedStyle(element).backgroundColor);
      assert.notEqual(before, after);
      assert.equal(await primary.evaluate(element => {
        const canvas = document.createElement('canvas').getContext('2d');
        canvas.fillStyle = getComputedStyle(element).getPropertyValue('--color-accent-strong');
        const expected = canvas.fillStyle;
        canvas.fillStyle = getComputedStyle(element).backgroundColor;
        return canvas.fillStyle === expected;
      }), true, "Hover reaches the distinct shared strong accent, not a transition serialization change");
      return { before, after };
    });
  }
  for (const reducedMotion of ["no-preference", "reduce"]) await scenario(`sidebar-${reducedMotion}`, { reducedMotion }, async (page, host) => {
    await host.locator('.cm-content').focus();
    await page.evaluate(() => {
      window.roundEightAnimations = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) { window.roundEightAnimations.push({ prose: this.matches('.write, .editor'), frames }); return animate.call(this, frames, options); };
    });
    await page.keyboard.press("Control+Backslash");
    await host.locator('.workspace.no-sidebar').waitFor();
    assert.equal(await host.locator('.write').evaluate(element => getComputedStyle(element).opacity), "1");
    await page.keyboard.press("Control+Backslash");
    await host.locator('.workspace:not(.no-sidebar)').waitFor();
    const animations = await page.evaluate(() => window.roundEightAnimations);
    assert.equal(animations.filter(animation => animation.prose).length, 0, JSON.stringify(animations));
    assert.equal(await host.locator('.write').evaluate(element => getComputedStyle(element).opacity), "1");
    return animations;
  });
  await scenario("tabs-271", {}, async (page, host) => {
    await host.locator('.outline').evaluate(element => element.style.width = '271px');
    const tabs = await host.locator('.sidebar-tabs [role="tab"]').evaluateAll(elements => elements.map(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      const box = range.getBoundingClientRect(); return { text: element.textContent, left: box.left, right: box.right };
    }));
    for (let index = 1; index < tabs.length; index++) assert.ok(tabs[index].left - tabs[index - 1].right >= 12, JSON.stringify(tabs));
    assert.ok(tabs[1].text.match(/\d/));
    assert.ok(tabs[2].text.match(/\d/));
    for (const tab of await host.locator('.sidebar-tabs [role="tab"]').all()) {
      await tab.click();
      assert.equal(await tab.getAttribute('aria-selected'), 'true');
      await tab.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
      assert.equal(await tab.evaluate(element => getComputedStyle(element).borderBottomColor !== 'rgba(0, 0, 0, 0)'), true);
    }
    return tabs;
  });
  await scenario("settle-after-save-only", {}, async (page, host) => {
    await page.mouse.move(0, 0);
    assert.equal(await host.locator('.save-slot .mdbase-settle').evaluateAll(elements => elements.flatMap(element => element.getAnimations().map(animation => animation.animationName))).then(names => names.filter(name => name === 'mdbase-settle').length), 0, "Opening is not a save");
    const notice = host.locator('.save-slot .mdbase-settle');
    assert.equal(await notice.evaluate(element => getComputedStyle(element).opacity), "0", "Opening has no save confirmation to announce visually");
    await host.locator('.bar-title').hover();
    assert.equal(await notice.evaluate(element => getComputedStyle(element).opacity), "1", "Hover still reveals the current status");
    await page.mouse.move(0, 0);
    await host.locator('.cm-content').focus();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText(" [test] round-eight save");
    await page.waitForFunction(() => [...document.querySelectorAll('#round-eight .save-slot .mdbase-settle')].some(element => element.getAnimations().some(animation => animation.animationName === 'mdbase-settle')));
    await notice.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    assert.equal(await notice.evaluate(element => getComputedStyle(element).opacity), "0", "A real save settles back to the quiet state");
    return { mount: 0, saved: 1 };
  });
  for (const width of [1440, 390]) await scenario(`reference-${width}`, { viewport: { width, height: 900 } }, async (page, host) => {
    await host.locator('.cm-content').focus();
    await page.keyboard.press("Control+/");
    const dialog = host.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
    await dialog.waitFor();
    await dialog.evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)); });
    const groups = await dialog.locator('.shortcut-group').evaluateAll(elements => elements.map(element => ({ x: Math.round(element.getBoundingClientRect().x), width: element.getBoundingClientRect().width })));
    const columns = new Set(groups.map(group => group.x)).size;
    assert.equal(columns, width === 1440 ? 2 : 1, JSON.stringify(groups));
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true);
    await page.screenshot({ path: `out/polish-r8/reference-${width}.png` });
    return { columns, groups };
  });
} finally { await browser.close(); writeFileSync('out/polish-r8/results.json', JSON.stringify(results, null, 2)); }
assert.equal(results.filter(result => !result.pass).length, 0, `${results.filter(result => !result.pass).length} round-eight regressions`);
