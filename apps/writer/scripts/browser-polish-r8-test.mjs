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
      Element.prototype.animate = function (frames, options) {
        const animation = animate.call(this, frames, options);
        const sample = { prose: this.matches('.write, .editor'), sidebar: this.matches('.outline'), frames, duration: options.duration };
        window.roundEightAnimations.push(sample);
        queueMicrotask(() => { sample.pending = animation.pending; sample.startTime = animation.startTime; });
        return animation;
      };
    });
    await page.keyboard.press("Control+Backslash");
    await host.locator('.workspace.no-sidebar').waitFor();
    assert.equal(await host.locator('.write').evaluate(element => getComputedStyle(element).opacity), "1");
    await page.keyboard.press("Control+Backslash");
    await host.locator('.workspace:not(.no-sidebar)').waitFor();
    const animations = await page.evaluate(() => window.roundEightAnimations);
    assert.equal(animations.filter(animation => animation.prose).length, 0, JSON.stringify(animations));
    const sidebar = animations.filter(animation => animation.sidebar);
    assert.equal(sidebar.length, reducedMotion === "reduce" ? 0 : 2, JSON.stringify(animations));
    assert.ok(sidebar.every(animation => !animation.pending && animation.startTime !== null), "Sidebar motion must start on the current timeline, not wait for a pending play task");
    if (sidebar.length) assert.deepEqual(sidebar.map(animation => animation.duration), [120, 160]);
    assert.equal(await host.locator('.write').evaluate(element => getComputedStyle(element).opacity), "1");
    return animations;
  });
  for (const colorScheme of ["light", "dark"]) await scenario(`tabs-range-${colorScheme}`, { colorScheme }, async (page, host) => {
    await page.evaluate(() => document.fonts.ready);
    const resizer = host.getByRole('separator', { name: 'Resize the sidebar', exact: true });
    const widths = [];
    await resizer.focus();
    await page.keyboard.press('Home');
    assert.equal(await resizer.getAttribute('aria-valuenow'), '200');
    for (let index = 0; index <= 20; index++) {
      const geometry = await host.locator('.outline').evaluate(element => {
        const sidebar = element.getBoundingClientRect();
        const controls = [...element.querySelectorAll('.sidebar-tabs button')].map(button => {
          const box = button.getBoundingClientRect();
          const range = document.createRange(); range.selectNodeContents(button);
          const text = range.getBoundingClientRect();
          return { text: button.textContent, left: Math.min(box.left, text.left), right: Math.max(box.right, text.right), top: box.top, bottom: box.bottom, hit: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
        });
        return { width: sidebar.width, left: sidebar.left, right: sidebar.right, controls };
      });
      assert.equal(geometry.width, 200 + index * 16);
      for (const control of geometry.controls) {
        assert.ok(control.left >= geometry.left && control.right <= geometry.right, JSON.stringify(geometry));
        assert.ok(control.hit, JSON.stringify(control));
      }
      assert.match(geometry.controls[1].text, /Sources9/);
      assert.match(geometry.controls[2].text, /Comments2/);
      widths.push(geometry.width);
      if (geometry.width === 248) {
        const position = () => host.locator('.outline').evaluate(element => ({ height: element.querySelector('.sidebar-tabs').getBoundingClientRect().height, panelTop: element.querySelector('.sidebar-panel').getBoundingClientRect().top, widths: [...element.querySelectorAll('.sidebar-tabs [role="tab"]')].map(tab => tab.getBoundingClientRect().width) }));
        const before = await position();
        for (const tab of await host.locator('.sidebar-tabs [role="tab"]').all()) {
          await tab.click();
          assert.deepEqual(await position(), before, 'Tab selection must not change wrapping or move the panel at 248 px');
        }
        await host.locator('.sidebar-tabs [role="tab"]').first().click();
        await resizer.focus();
      }
      await page.keyboard.press('ArrowRight');
    }
    await page.keyboard.press('Home');
    await host.locator('.sidebar-tabs [role="tab"]').first().focus();
    for (const name of ['Sources', 'Comments', 'Outline']) {
      await page.keyboard.press('ArrowRight');
      assert.match(await host.locator('.sidebar-tabs [aria-selected="true"]').innerText(), new RegExp(name));
    }
    for (const tab of await host.locator('.sidebar-tabs [role="tab"]').all()) {
      await tab.click();
      assert.equal(await tab.getAttribute('aria-selected'), 'true');
      assert.equal(await tab.evaluate(element => {
        const sidebar = element.closest('.outline').getBoundingClientRect();
        const range = document.createRange(); range.selectNodeContents(element);
        const text = range.getBoundingClientRect();
        return text.left >= sidebar.left && text.right <= sidebar.right;
      }), true, 'The selected tab and its count remain contained at 200 px');
    }
    await page.screenshot({ path: `out/polish-r8/tabs-200-${colorScheme}.png` });
    await resizer.focus();
    await page.keyboard.press('End');
    assert.equal(await resizer.getAttribute('aria-valuenow'), '520');
    return { widths, minimum: 200, maximum: 520 };
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
  for (const afterSave of [false, true]) await scenario(`settle-clean-reconnect-${afterSave ? 'after-save' : 'initial'}`, {}, async (page, host) => {
    await page.mouse.move(0, 0);
    if (afterSave) {
      await host.locator('.cm-content').focus();
      await page.keyboard.insertText(' [test] save before clean reconnect');
      await page.waitForFunction(() => [...document.querySelectorAll('#round-eight .save-slot .mdbase-settle')].some(element => element.getAnimations().some(animation => animation.animationName === 'mdbase-settle')));
      await host.locator('.save-slot .mdbase-settle').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
      await host.locator('.cm-content').focus();
      await host.locator('.cm-content').evaluate(element => element.blur());
    }
    assert.equal(await page.evaluate(() => {
      const snapshot = window.roundEight.workspace.getSnapshot();
      return !snapshot.pendingSettings && [...snapshot.records.values()].every(record => !record.snapshot.dirty && record.snapshot.state === 'saved');
    }), true, 'Reconnect fixture has no edits or dirty records');
    await page.evaluate(() => {
      window.settleAnimations = [];
      window.captureSettle = event => { if (event.animationName === 'mdbase-settle' && event.target.closest('#round-eight .save-slot')) window.settleAnimations.push(event.animationName); };
      document.addEventListener('animationstart', window.captureSettle);
      window.roundEight.notice('offline');
    });
    await host.locator('.save-slot .is-pending').waitFor();
    await page.evaluate(() => window.roundEight.notice(null));
    await host.locator('.save-slot .is-saved').waitFor();
    const animations = await host.locator('.save-slot .is-saved').evaluate(async element => {
      const active = element.getAnimations().map(animation => animation.animationName);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      document.removeEventListener('animationstart', window.captureSettle);
      return [...active, ...window.settleAnimations];
    });
    assert.deepEqual(animations, [], 'A clean reconnect is not a save, including after an earlier genuine save');
    return { afterSave, dirty: 0, reconnectAnimations: animations.length };
  });
  await scenario('settle-write-still-pending', {}, async (page, host) => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      const workspace = window.roundEight.workspace;
      workspace.setBody(workspace.main, `${workspace.getSnapshot().records.get(workspace.main).snapshot.body} [test] unsettled write`);
      window.roundEight.notice('offline');
    });
    await host.locator('.save-slot .is-pending').waitFor();
    await page.evaluate(() => window.roundEight.notice(null));
    await host.locator('.save-slot .is-pending').waitFor();
    assert.equal(await page.evaluate(() => window.roundEight.workspace.getSnapshot().records.get(window.roundEight.workspace.main).snapshot.dirty), true);
    assert.equal(await host.locator('.save-slot .mdbase-settle').count(), 0, 'A reconnect cannot settle a write still awaiting acknowledgment');
    await page.evaluate(() => window.roundEight.workspace.retrySave());
    await page.waitForFunction(() => [...document.querySelectorAll('#round-eight .save-slot .mdbase-settle')].some(element => element.getAnimations().some(animation => animation.animationName === 'mdbase-settle')));
    await host.locator('.save-slot .mdbase-settle').evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    assert.equal(await host.locator('.save-slot .mdbase-settle').evaluate(element => getComputedStyle(element).opacity), '0');
    return { pendingBeforeAcknowledgment: true, settledAfterAcknowledgment: true };
  });
  await scenario('settle-acknowledged-while-reconnecting', {}, async (page, host) => {
    await page.mouse.move(0, 0);
    await page.evaluate(() => {
      window.settleCount = 0;
      document.addEventListener('animationstart', event => {
        if (event.animationName === 'mdbase-settle' && event.target.closest('#round-eight .save-slot')) window.settleCount++;
      });
      window.roundEight.notice('reconnecting');
    });
    await host.locator('.save-slot .is-pending').waitFor();
    await host.locator('.cm-content').focus();
    await page.keyboard.insertText(' [test] acknowledge while reconnecting');
    assert.equal(await page.evaluate(() => window.roundEight.workspace.getSnapshot().records.get(window.roundEight.workspace.main).snapshot.dirty), true);
    assert.equal(await page.evaluate(async () => (await window.roundEight.workspace.retrySave()).ok), true);
    assert.deepEqual(await page.evaluate(() => {
      const record = window.roundEight.workspace.getSnapshot().records.get(window.roundEight.workspace.main).snapshot;
      return { state: record.state, dirty: record.dirty, confirmations: window.settleCount };
    }), { state: 'saved', dirty: false, confirmations: 0 });
    assert.equal(await host.locator('.save-slot .mdbase-settle').count(), 0, 'The connection notice still owns the status');
    await page.evaluate(() => window.roundEight.notice(null));
    await host.locator('.save-slot .is-saved').waitFor();
    await host.locator('.save-slot .is-saved').evaluate(async element => {
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    assert.equal(await page.evaluate(() => window.settleCount), 1, 'A real acknowledgment hidden by Reconnecting must show exactly one confirmation when it clears');
    await page.evaluate(() => window.roundEight.notice('reconnecting'));
    await host.locator('.save-slot .is-pending').waitFor();
    await page.evaluate(() => window.roundEight.notice(null));
    await host.locator('.save-slot .is-saved').evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.settleCount), 1, 'A later clean reconnect cannot replay the consumed acknowledgment');
    return { acknowledgedWhileReconnecting: true, confirmations: 1, replayed: 0 };
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
