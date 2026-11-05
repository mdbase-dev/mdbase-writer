import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:5320/";
const output = "out/polish-r1";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const results = [];

async function probe(page, selector, action, reverse) {
  return page.evaluate(async ({ selector, action, reverse }) => {
    const frames = [];
    const animations = [];
    const perform = (operation) => {
      if (operation === "settings") document.querySelector('.bar button[aria-label="Settings"]').click();
      else if (operation === "sidebar") document.querySelector('.bar button[aria-label="Sidebar"]').click();
      else if (operation === "phone-sidebar") document.querySelector(`.pane-tabs button:nth-child(${document.querySelector(".workspace").classList.contains("pane-outline") ? 2 : 1})`).click();
      else if (operation === "insert") document.querySelector('.bar button[aria-label="Insert"]').click();
      else if (operation === "new") [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "New manuscript").click();
      else if (operation === "dialog-close") document.querySelector('.mdbase-dialog[open] button[aria-label="Close"]').click();
      else {
        const target = document.querySelector(".mdbase-command-palette input") ?? document.activeElement;
        target.dispatchEvent(new KeyboardEvent("keydown", { key: operation === "palette" ? "k" : "Escape", code: operation === "palette" ? "KeyK" : "Escape", ctrlKey: operation === "palette", bubbles: true, cancelable: true }));
      }
    };
    const measure = () => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      return { left: element.getBoundingClientRect().left, opacity: Number(style.opacity), transform: style.transform, columns: style.gridTemplateColumns };
    };
    perform(action);
    const started = performance.now();
    let reversed = false;
    let interruption;
    await new Promise((resolve) => {
      const sample = () => {
        const elapsed = performance.now() - started;
        frames.push({ elapsed, ...measure() });
        for (const animation of document.getAnimations()) {
          const target = animation.effect?.target;
          if (target?.matches?.(selector) && !animations.some((entry) => entry.id === animation.id && entry.duration === animation.effect.getTiming().duration && entry.startTime === animation.startTime)) {
            animations.push({ id: animation.id, target: target.className, startTime: animation.startTime, duration: animation.effect.getTiming().duration, frames: animation.effect.getKeyframes() });
          }
        }
        if (reverse && !reversed && elapsed >= 45) {
          const before = measure();
          perform(reverse);
          interruption = { before, after: measure() };
          reversed = true;
        }
        if (elapsed < 350) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    return { frames, animations, interruption };
  }, { selector, action, reverse });
}

function motion(result, reduced, duration, property = "opacity") {
  if (reduced) assert.equal(result.animations.length, 0, "Reduced motion must have no target animation");
  else {
    assert.ok(result.animations.some((animation) => animation.duration === duration), `Missing ${duration}ms animation`);
    assert.ok(new Set(result.frames.map((frame) => frame[property]).filter((value) => value !== undefined)).size >= 3, `No continuous ${property} trajectory`);
  }
}

try {
  for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"]) for (const reducedMotion of ["no-preference", "reduce"]) {
    const name = `${width}-${colorScheme}-${reducedMotion}`;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme, reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const result = { name };
    try {
      await page.goto(`${base}?demo`);
      await page.locator('.manuscript-row[data-path="manuscripts/slow-change.md"]').waitFor();
      assert.match(await page.locator(".home").innerText(), /Demo · resets on reload/);
      motion(await probe(page, ".mdbase-dialog", "new"), reducedMotion === "reduce", 160);
      motion(await probe(page, ".mdbase-dialog", "dialog-close"), reducedMotion === "reduce", 120);
      await page.evaluate(() => {
        window.startup = [];
        document.querySelector('.manuscript-row[data-path="manuscripts/slow-change.md"]').addEventListener("pointerdown", () => {
          const started = performance.now();
          const sample = () => {
            const canvas = document.querySelector(".preview-pages canvas.page");
            const frame = { elapsed: performance.now() - started, editor: Boolean(document.querySelector(".cm-content")), canvas: Boolean(canvas), drawn: Boolean(canvas?.dataset.version) };
            window.startup.push(frame);
            if (!frame.drawn && frame.elapsed < 15000) requestAnimationFrame(sample);
          };
          requestAnimationFrame(sample);
        }, { once: true });
      });
      await page.locator('.manuscript-row[data-path="manuscripts/slow-change.md"]').click();
      await page.locator(".cm-content").waitFor();
      assert.match(await page.locator(".demo-identity").innerText(), /resets on reload/);
      if (width === 390) await page.getByRole("button", { name: "Preview", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".preview-pages canvas.page")?.dataset.version);
      result.startup = await page.evaluate(() => ({ editorMs: window.startup.find((frame) => frame.editor)?.elapsed, canvasMs: window.startup.find((frame) => frame.canvas)?.elapsed, drawnMs: window.startup.find((frame) => frame.drawn)?.elapsed }));
      result.preview = await page.locator(".preview").evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, pages: [...element.querySelectorAll(".preview-page")].map((page) => page.getBoundingClientRect().width) }));
      assert.ok(result.preview.scrollWidth <= result.preview.width + 1, "Fit preview overflows");
      assert.equal(await page.locator(".text-layer a").evaluateAll((anchors) => anchors.filter((anchor) => !anchor.textContent.trim() && !anchor.getAttribute("aria-label")?.trim()).length), 0);
      const semantics = await page.evaluate(async () => {
        const { semanticLayer } = await import("/src/preview/semantics.ts");
        const fragment = semanticLayer('<a href="#"><span></span></a><a href="https://example.com">Read source</a><script>alert(1)</script>');
        return { links: fragment.querySelectorAll("a").length, text: fragment.textContent, scripts: fragment.querySelectorAll("script").length };
      });
      assert.deepEqual(semantics, { links: 1, text: "Read source", scripts: 0 });
      await page.screenshot({ path: `${output}/${name}-preview.png` });
      if (width === 390) await page.getByRole("button", { name: "Write", exact: true }).click();
      await page.locator(".cm-content").click();
      await page.keyboard.press("Control+f");
      result.findHeight = await page.locator(".cm-search").evaluate((element) => element.getBoundingClientRect().height);
      assert.ok(result.findHeight < 160, `Find panel is ${result.findHeight}px tall`);
      assert.match(await page.locator(".cm-search").innerText(), /Regular expression/);
      await page.getByRole("textbox", { name: "Find in this record", exact: true }).fill("Darwin");
      await page.locator('.cm-search button[name="next"]').click();
      await page.getByRole("textbox", { name: "Replace", exact: true }).fill("Darwin test");
      await page.locator('.cm-search button[name="replace"]').click();
      await page.screenshot({ path: `${output}/${name}-find.png` });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+z");
      await page.screenshot({ path: `${output}/${name}-editor.png` });
      if (width === 390) await page.locator(".pane-tabs button").nth(0).click();
      await page.getByRole("tab", { name: /^Comments/ }).click();
      result.comments = await page.locator(".comments-bar").evaluate((element) => ({ right: element.getBoundingClientRect().right, children: [...element.children].map((child) => child.getBoundingClientRect().right) }));
      assert.ok(result.comments.children.every((right) => right <= result.comments.right + 1), "Comment action clipped");
      await page.getByRole("tab", { name: "Outline", exact: true }).click();
      result.contrast = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        const rgb = (color) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const luminance = (color) => color.slice(0, 3).map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
        return [...document.querySelectorAll(".heading-count,.heading-words,.tab-count,.bar-problems.is-clear")].filter((element) => element.getBoundingClientRect().width).map((element) => {
          let background = element;
          while (background && rgb(getComputedStyle(background).backgroundColor)[3] < 255) background = background.parentElement;
          const foreground = luminance(rgb(getComputedStyle(element).color));
          const behind = luminance(rgb(getComputedStyle(background).backgroundColor));
          return { selector: element.className, ratio: (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05) };
        });
      });
      assert.ok(result.contrast.length > 0);
      assert.ok(result.contrast.every((entry) => entry.ratio >= 4.5), JSON.stringify(result.contrast));
      if (width === 390) await page.getByRole("button", { name: "Write", exact: true }).click();
      const reduced = reducedMotion === "reduce";
      result.settingsIn = await probe(page, ".settings-sheet", "settings");
      motion(result.settingsIn, reduced, 160);
      await page.screenshot({ path: `${output}/${name}-settings.png` });
      result.settingsOut = await probe(page, ".settings-sheet", "settings");
      motion(result.settingsOut, reduced, 120);
      assert.equal(await page.locator(".settings-sheet").count(), 0);
      result.settingsReversal = await probe(page, ".settings-sheet", "settings", "settings");
      if (!reduced) assert.ok(Math.abs(result.settingsReversal.interruption.before.opacity - result.settingsReversal.interruption.after.opacity) < 0.02);
      await probe(page, ".settings-sheet", "settings");
      result.settingsReopen = await probe(page, ".settings-sheet", "settings", "settings");
      if (!reduced) assert.ok(Math.abs(result.settingsReopen.interruption.before.opacity - result.settingsReopen.interruption.after.opacity) < 0.02);
      await probe(page, ".settings-sheet", "settings");
      result.paletteIn = await probe(page, ".mdbase-command-backdrop", "palette");
      motion(result.paletteIn, reduced, 160);
      result.paletteOut = await probe(page, ".mdbase-command-backdrop", "escape");
      motion(result.paletteOut, reduced, 120);
      result.paletteReversal = await probe(page, ".mdbase-command-backdrop", "palette", "palette");
      if (!reduced) assert.ok(Math.abs(result.paletteReversal.interruption.before.opacity - result.paletteReversal.interruption.after.opacity) < 0.02);
      await probe(page, ".mdbase-command-backdrop", "palette");
      result.paletteReopen = await probe(page, ".mdbase-command-backdrop", "palette", "palette");
      if (!reduced) assert.ok(Math.abs(result.paletteReopen.interruption.before.opacity - result.paletteReopen.interruption.after.opacity) < 0.02);
      await probe(page, ".mdbase-command-backdrop", "escape");
      result.menuIn = await probe(page, ".popover", "insert");
      motion(result.menuIn, reduced, 160);
      result.menuOut = await probe(page, ".popover", "insert");
      motion(result.menuOut, reduced, 120);
      result.menuReversal = await probe(page, ".popover", "insert", "insert");
      if (!reduced) assert.ok(Math.abs(result.menuReversal.interruption.before.opacity - result.menuReversal.interruption.after.opacity) < 0.02);
      if (width === 1440) {
        result.sidebarOut = await probe(page, ".workspace", "sidebar");
        motion(result.sidebarOut, reduced, 120, "columns");
        result.sidebarIn = await probe(page, ".workspace", "sidebar");
        motion(result.sidebarIn, reduced, 160, "columns");
      } else {
        result.sidebarIn = await probe(page, ".outline", "phone-sidebar");
        motion(result.sidebarIn, reduced, 160);
        result.sidebarOut = await probe(page, ".outline", "phone-sidebar");
        motion(result.sidebarOut, reduced, 120);
      }
      const sidebarSelector = width === 1440 ? ".workspace" : ".outline";
      const sidebarAction = width === 1440 ? "sidebar" : "phone-sidebar";
      result.sidebarReversal = await probe(page, sidebarSelector, sidebarAction, sidebarAction);
      await probe(page, sidebarSelector, sidebarAction);
      result.sidebarReopen = await probe(page, sidebarSelector, sidebarAction, sidebarAction);
      await probe(page, sidebarSelector, sidebarAction);
      if (!reduced) {
        for (const reversal of [result.sidebarReversal, result.sidebarReopen]) {
          const { before, after } = reversal.interruption;
          assert.ok(Math.abs(width === 1440 ? parseFloat(before.columns) - parseFloat(after.columns) : before.opacity - after.opacity) < (width === 1440 ? 1 : 0.02));
          assert.ok(reversal.animations.length > 0);
        }
        result.preferenceChange = await page.evaluate(async () => {
          document.querySelector('.bar button[aria-label="Settings"]').click();
          await new Promise(requestAnimationFrame);
          return document.getAnimations().filter((animation) => animation.effect?.target?.matches?.(".settings-sheet")).length;
        });
        assert.ok(result.preferenceChange > 0, "Settings was not animating before Reduce");
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.waitForFunction(() => document.getAnimations().length === 0);
        assert.equal(await page.locator(".settings-sheet").evaluate((element) => getComputedStyle(element).transform), "none");
        await page.getByRole("button", { name: "Close settings", exact: true }).click();
        assert.equal(await page.locator(".settings-sheet").count(), 0);
      }
      if (reduced) assert.equal(await page.evaluate(() => document.getAnimations().length), 0, "Motion survives under Reduce");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width, "Page overflows");
      assert.deepEqual(errors, []);
      result.ok = true;
      console.log(`ok ${name}: Find ${result.findHeight}px, canvas ${Math.round(result.startup.canvasMs)}ms`);
    } catch (error) {
      result.error = String(error);
      await page.screenshot({ path: `${output}/${name}-failure.png` });
      console.error(`FAIL ${name}: ${error.stack}`);
    } finally {
      results.push(result);
      writeFileSync(`${output}/matrix.json`, JSON.stringify(results, null, 2));
      await context.close();
    }
  }
  assert.ok(results.every((result) => result.ok), "Polish matrix failed; see out/polish-r1/matrix.json");
  const context = await browser.newContext();
  const page = await context.newPage();
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  await page.route("**/typst_ts_web_compiler_bg.wasm*", async (route) => { await held; await route.continue(); });
  try {
    await page.goto(`${base}?demo`);
    await page.getByRole("button", { name: "New manuscript", exact: true }).waitFor();
    motion(await probe(page, ".mdbase-dialog", "new"), false, 160);
    motion(await probe(page, ".mdbase-dialog", "dialog-close"), false, 120);
    await page.getByRole("button", { name: "New manuscript", exact: true }).click();
    await page.getByRole("textbox", { name: "Title", exact: true }).fill("Polish reset test");
    await page.getByRole("button", { name: "Create manuscript", exact: true }).click();
    await page.locator(".cm-content").waitFor();
    assert.equal(await page.locator(".cm-placeholder").innerText(), "Start writing. Type / to insert or @ to cite.");
    assert.equal(await page.evaluate(() => window.writer.workspace.getSnapshot().records.get(window.writer.workspace.main).snapshot.body), "");
    assert.equal(await page.getByText("Preparing the preview. You can keep writing.", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Typesetting…", { exact: true }).count(), 0);
    await page.locator(".cm-content").fill("A temporary demo paragraph.");
    await page.getByText("Saved for this demo session", { exact: true }).waitFor({ state: "visible" });
    await page.waitForFunction(() => [...window.writer.workspace.getSnapshot().records.values()].every((record) => record.snapshot.state === "saved"));
    release();
    await page.reload();
    await page.getByRole("heading", { name: "This manuscript could not be opened" }).waitFor();
    assert.match(await page.locator("body").innerText(), /Reloading resets the sample collection/);
    await page.getByRole("button", { name: "Back to demo manuscripts", exact: true }).click();
    await page.getByRole("heading", { name: "Manuscripts", exact: true }).waitFor();
    assert.equal(await page.getByText("Polish reset test", { exact: true }).count(), 0);
    console.log("ok empty manuscript, single preparing message, demo save and reset recovery");
  } finally {
    release();
    await context.close();
  }
} finally {
  await browser.close();
}
