import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:5320/";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const output = "out/polish-main";
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const results = [];

async function probe(page, selector, action, reverse) {
  return page.evaluate(async ({ selector, action, reverse }) => {
    const frames = [];
    const animations = [];
    const controlled = new Set();
    const captureAnimations = () => {
      for (const animation of document.getAnimations()) {
        const target = animation.effect?.target;
        if (target?.matches?.(selector) && !controlled.has(animation)) {
          animation.pause();
          animation.currentTime = 0;
          controlled.add(animation);
        }
        if (target?.matches?.(selector) && !animations.some((entry) => entry.id === animation.id && entry.duration === animation.effect.getTiming().duration && entry.startTime === animation.startTime)) {
          animations.push({ id: animation.id, target: target.className, startTime: animation.startTime, duration: animation.effect.getTiming().duration, frames: animation.effect.getKeyframes() });
        }
      }
    };
    const perform = (operation) => {
      if (operation === "settings") document.querySelector('.bar button[aria-label="Settings"]').click();
      else if (operation === "sidebar") document.querySelector('.bar button[aria-label="Sidebar"]').click();
      else if (operation === "lower") document.querySelector('.sidebar-split').click();
      else if (operation === "lower-close") document.querySelector('.sidebar-lower button[aria-label="Close the lower panel"]').click();
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
      if (!element || getComputedStyle(element).display === "none") return null;
      const style = getComputedStyle(element);
      return { left: element.getBoundingClientRect().left, height: element.getBoundingClientRect().height, opacity: Number(style.opacity), transform: style.transform, columns: style.gridTemplateColumns, rows: style.gridTemplateRows, inert: element.inert, hidden: element.ariaHidden, proseOpacity: selector === ".outline" ? Number(getComputedStyle(document.querySelector(".write")).opacity) : undefined };
    };
    const observer = new MutationObserver(captureAnimations);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-open"] });
    perform(action);
    const started = performance.now();
    let reversed = false;
    let interruption;
    await new Promise((resolve) => {
      const sample = () => {
        const elapsed = performance.now() - started;
        const measurement = measure();
        frames.push({ elapsed, present: measurement !== null, ...measurement });
        captureAnimations();
        const inMotion = selector === ".outline" ? elapsed >= 45 : measurement?.opacity > 0.35 && measurement.opacity < 0.65;
        if (reverse && !reversed && (matchMedia("(prefers-reduced-motion: reduce)").matches ? elapsed >= 45 : inMotion)) {
          const before = measure();
          perform(reverse);
          interruption = { before, after: measure() };
          reversed = true;
        } else {
          for (const animation of controlled) {
            if (animation.playState !== "paused") continue;
            const duration = animation.effect.getComputedTiming().activeDuration;
            animation.currentTime = Math.min(duration, Number(animation.currentTime) + duration / 8);
            if (animation.currentTime >= duration) animation.finish();
          }
        }
        const element = document.querySelector(selector);
        const running = element?.getAnimations().some(animation => animation.playState === "running" || animation.playState === "paused" || animation.pending);
        const closing = element && (element.inert || element.ariaHidden === "true");
        if (elapsed < 350 || elapsed < 2000 && (running || closing)) requestAnimationFrame(sample);
        else resolve();
      };
      requestAnimationFrame(sample);
    });
    observer.disconnect();
    return { selector, frames, animations, interruption };
  }, { selector, action, reverse });
}

function motion(result, reduced, duration, property = "opacity") {
  if (reduced) assert.equal(result.animations.length, 0, "Reduced motion must have no target animation");
  else {
    assert.ok(result.animations.some((animation) => animation.duration === duration), `Missing ${duration}ms animation`);
    assert.ok(new Set(result.frames.map((frame) => frame[property]).filter((value) => value !== undefined)).size >= 3, `No continuous ${property} trajectory`);
  }
  if (duration === 120 && [".mdbase-dialog", ".mdbase-command-palette", ".settings-sheet", ".sidebar-lower", ".popover"].includes(result.selector)) {
    let opacity = 1;
    let removed = false;
    for (const frame of result.frames) {
      assert.ok(!removed || !frame.present, "Exiting overlay reappeared after removal");
      if (!frame.present) removed = true;
      else {
        assert.ok(frame.opacity <= opacity + 0.005, `Exit opacity rose from ${opacity} to ${frame.opacity} at ${frame.elapsed}ms`);
        opacity = frame.opacity;
      }
    }
    assert.ok(removed, "Exit never removed the overlay");
  }
}

try {
  for (const width of [1440, 390]) for (const colorScheme of ["light", "dark"]) for (const reducedMotion of ["no-preference", "reduce"]) {
    const name = `${width}-${colorScheme}-${reducedMotion}`;
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, colorScheme, reducedMotion });
    await context.addInitScript(() => localStorage.setItem("mdbase-writer:export", "bundle"));
    await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const result = { name };
    try {
      await page.goto(`${base}?demo`);
      await page.locator('.home [data-path][data-path="manuscripts/slow-change.md"]').waitFor();
      assert.match(await page.locator(".home").innerText(), /Demo collection · resets on reload/);
      result.dialogIn = await probe(page, ".mdbase-dialog", "new");
      motion(result.dialogIn, reducedMotion === "reduce", 160);
      result.dialogOut = await probe(page, ".mdbase-dialog", "dialog-close");
      motion(result.dialogOut, reducedMotion === "reduce", 120);
      await page.evaluate(() => {
        window.startup = [];
        document.querySelector('.home [data-path][data-path="manuscripts/slow-change.md"]').addEventListener("pointerdown", () => {
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
      await page.locator('.home [data-path][data-path="manuscripts/slow-change.md"]').click();
      await page.locator(".cm-content").waitFor();
      assert.equal(await page.locator(".demo-identity").innerText(), "Demo");
      assert.match(await page.locator(".demo-identity").getAttribute("title"), /reset on reload/);
      if (width === 1440) {
        await page.waitForFunction(() => { const snapshot = window.writer.workspace.getSnapshot(); return snapshot.phase === "ready" && snapshot.indexLoad.phase === "ready" && snapshot.libraryLoad.phase === "ready" && snapshot.annotationsLoad.phase === "ready"; });
        assert.ok(await page.locator(".bar-title").evaluate(element => element.getBoundingClientRect().width >= 240), "Settled manuscript title is too narrow");
      }
      if (name === "1440-light-no-preference") {
        for (const middleWidth of [901, 1000, 1180, 1280]) {
          await page.setViewportSize({ width: middleWidth, height: 900 });
          assert.ok(await page.locator('.bar button[aria-label="More"]').evaluate(element => element.getBoundingClientRect().right <= innerWidth), `Toolbar overflow at ${middleWidth}px`);
          assert.equal(await page.locator('.bar .mdbase-save-notice').innerText(), "Saved");
          assert.equal(await page.locator(".demo-identity").innerText(), "Demo");
        }
        await page.setViewportSize({ width, height: 900 });
      }
      if (width === 390) await page.getByRole("button", { name: "Preview", exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".preview-pages canvas.page")?.dataset.version);
      assert.equal(await page.locator(".preview .text-layer[tabindex]").count(), 0);
      assert.ok(await page.locator(".preview .text-layer a[href]").evaluateAll(elements => elements.every(element => element.tabIndex === 0)));
      await page.locator(".preview").focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement?.matches(".text-layer")), false);
      result.startup = await page.evaluate(() => ({ editorMs: window.startup.find((frame) => frame.editor)?.elapsed, canvasMs: window.startup.find((frame) => frame.canvas)?.elapsed, drawnMs: window.startup.find((frame) => frame.drawn)?.elapsed }));
      result.preview = await page.locator(".preview").evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, pages: [...element.querySelectorAll(".preview-page")].map((page) => page.getBoundingClientRect().width) }));
      assert.ok(result.preview.scrollWidth <= result.preview.width + 1, "Fit preview overflows");
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Document overflows while Preview is selected");
      assert.ok(await page.locator(".preview-header").evaluate(element => element.getBoundingClientRect().right <= innerWidth), "Preview header overflows");
      assert.equal(await page.getByRole("main").count(), 1);
      assert.equal(await page.getByRole("heading", { level: 1 }).innerText(), await page.locator(".bar-title").getAttribute("title"));
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
      const beforeFind = await page.evaluate(() => [...window.writer.workspace.getSnapshot().records.values()].map(record => record.snapshot.body));
      await page.keyboard.press("Control+f");
      await page.keyboard.type("Darwin");
      assert.equal(await page.getByRole("textbox", { name: "Find", exact: true }).inputValue(), "Darwin");
      assert.deepEqual(await page.evaluate(() => [...window.writer.workspace.getSnapshot().records.values()].map(record => record.snapshot.body)), beforeFind, "Find text entered the manuscript");
      const editorState = () => page.evaluate(async () => (await import("/scripts/browser-a11y-fixture.tsx")).editorSnapshot());
      await page.keyboard.press("Enter");
      let match = await editorState();
      assert.equal(match.selected.toLowerCase(), "darwin");
      for (const key of ["F3", "Control+g", "Shift+F3", "Control+Shift+g"]) {
        await page.getByRole("textbox", { name: "Find", exact: true }).focus();
        await page.keyboard.press(key);
        const next = await editorState();
        assert.equal(next.selected.toLowerCase(), "darwin");
        assert.notEqual(next.from, match.from, `${key} did not navigate from the Find field`);
        match = next;
      }
      result.findHeight = await page.locator(".cm-search").evaluate((element) => element.getBoundingClientRect().height);
      assert.ok(result.findHeight < 160, `Find panel is ${result.findHeight}px tall`);
      assert.equal(await page.locator(".cm-search .cm-button, .cm-search .cm-textfield").count(), 0);
      assert.ok(result.findHeight < 62, `Find must stay one row: ${result.findHeight}`);
      assert.equal(await page.locator('.writer-find > button[name="close"]').evaluate(element => getComputedStyle(element).position), "static");
      assert.ok(await page.locator(".writer-find").evaluate(element => element.querySelector("summary").getBoundingClientRect().right <= element.querySelector('[name="close"]').getBoundingClientRect().left), "Find options overlap Close");
      await page.locator(".writer-find summary").click();
      await page.getByRole("button", { name: "Regular expression", exact: true }).press("Space");
      assert.equal(await page.getByRole("button", { name: "Regular expression", exact: true }).getAttribute("aria-pressed"), "true");
      await page.getByRole("button", { name: "Regular expression", exact: true }).press("Space");
      await page.locator('.cm-search button[name="next"]').click();
      await page.getByRole("textbox", { name: "Replace", exact: true }).focus();
      await page.keyboard.type("Darwin test");
      const replacing = await editorState();
      await page.keyboard.press("Enter");
      assert.equal((await editorState()).text, replacing.text.slice(0, replacing.from) + "Darwin test" + replacing.text.slice(replacing.to), "Replace Enter did not replace the selected match");
      await page.screenshot({ path: `${output}/${name}-find.png` });
      await page.keyboard.press("Escape");
      await page.keyboard.press("Control+z");
      await page.screenshot({ path: `${output}/${name}-editor.png` });
      if (width === 390) await page.locator(".pane-tabs button").nth(0).click();
      await page.getByRole("tab", { name: /^Comments/ }).click();
      result.comments = await page.locator(".mdbase-comments-bar").evaluate((element) => ({ right: element.getBoundingClientRect().right, children: [...element.children].map((child) => child.getBoundingClientRect().right) }));
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
        return [...document.querySelectorAll(".heading-count,.heading-words,.tab-count,.cm-attr")].filter((element) => element.getBoundingClientRect().width).map((element) => {
          let background = element;
          while (background && rgb(getComputedStyle(background).backgroundColor)[3] < 255) background = background.parentElement;
          const foreground = luminance(rgb(getComputedStyle(element).color));
          const behind = luminance(rgb(getComputedStyle(background).backgroundColor));
          return { selector: element.className, ratio: (Math.max(foreground, behind) + 0.05) / (Math.min(foreground, behind) + 0.05) };
        });
      });
      assert.ok(result.contrast.length > 0);
      assert.ok(result.contrast.every((entry) => entry.ratio >= (entry.selector.includes("cm-attr") ? 3 : 4.5)), JSON.stringify(result.contrast));
      const reduced = reducedMotion === "reduce";
      result.lowerIn = await probe(page, ".sidebar-lower", "lower");
      motion(result.lowerIn, reduced, 160);
      if (!reduced) assert.ok(new Set(result.lowerIn.frames.map(frame => frame.height)).size >= 3, "Lower panel geometry snapped");
      const lowerPanel = page.locator('.sidebar-lower [role="tabpanel"]');
      assert.equal(await lowerPanel.getAttribute("aria-labelledby"), "lower-sidebar-tab-comments");
      assert.equal(await page.locator('.sidebar-lower [role="tab"][tabindex="0"]').count(), 1);
      await page.locator('#lower-sidebar-tab-comments').focus();
      await page.keyboard.press("Home");
      await page.locator('#lower-sidebar-tab-sources[aria-selected="true"]').waitFor();
      await page.waitForFunction(() => document.activeElement?.id === "lower-sidebar-tab-sources");
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => document.activeElement?.id === "lower-sidebar-tab-comments");
      result.lowerComments = await page.locator('.sidebar-lower .mdbase-comments-bar').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
      assert.ok(result.lowerComments.scrollWidth <= result.lowerComments.width + 1, "Lower Comments actions overflow");
      await page.screenshot({ path: `${output}/${name}-lower.png` });
      result.lowerOut = await probe(page, ".sidebar-lower", "lower-close");
      motion(result.lowerOut, reduced, 120);
      assert.ok(await page.locator('.sidebar-split').evaluate(element => document.activeElement === element), "Lower close loses focus");
      assert.equal(await page.locator('.sidebar-lower').count(), 0);
      result.lowerReversal = await probe(page, ".sidebar-lower", "lower", "lower");
      await probe(page, ".sidebar-lower", "lower");
      result.lowerReopen = await probe(page, ".sidebar-lower", "lower", "lower");
      await probe(page, ".sidebar-lower", "lower");
      if (!reduced) for (const reversal of [result.lowerReversal, result.lowerReopen]) {
        assert.ok(Math.abs(reversal.interruption.before.opacity - reversal.interruption.after.opacity) < 0.02, "Lower reversal jumps");
        assert.ok(reversal.animations.some(animation => animation.duration > 0 && animation.duration <= 160 && animation.frames.at(-1).opacity === "1"), "CSS reversal must still animate in within the shared entry budget");
        assert.ok(reversal.animations.some(animation => animation.duration > 0 && animation.duration <= 120 && animation.frames.at(-1).opacity === "0"), "CSS reversal must still animate out within the shared exit budget");
      }
      if (width === 390) await page.getByRole("button", { name: "Write", exact: true }).click();
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
      result.paletteIn = await probe(page, ".mdbase-command-palette", "palette");
      assert.deepEqual(await page.locator(".mdbase-command-group").allTextContents(), ["Chapters", "Manuscript", "Format", "Insert", "Comments", "View", "Export", "Help"]);
      motion(result.paletteIn, reduced, 160);
      result.paletteOut = await probe(page, ".mdbase-command-palette", "escape");
      motion(result.paletteOut, reduced, 120);
      result.paletteReversal = await probe(page, ".mdbase-command-palette", "palette", "palette");
      if (!reduced) assert.ok(Math.abs(result.paletteReversal.interruption.before.opacity - result.paletteReversal.interruption.after.opacity) < 0.02);
      await probe(page, ".mdbase-command-palette", "palette");
      result.paletteReopen = await probe(page, ".mdbase-command-palette", "palette", "palette");
      if (!reduced) assert.ok(Math.abs(result.paletteReopen.interruption.before.opacity - result.paletteReopen.interruption.after.opacity) < 0.02);
      await probe(page, ".mdbase-command-palette", "escape");
      result.menuIn = await probe(page, ".popover", "insert");
      motion(result.menuIn, reduced, 160);
      result.menuOut = await probe(page, ".popover", "insert");
      motion(result.menuOut, reduced, 120);
      result.menuReversal = await probe(page, ".popover", "insert", "insert");
      if (!reduced) assert.ok(Math.abs(result.menuReversal.interruption.before.opacity - result.menuReversal.interruption.after.opacity) < 0.02);
      if (width === 1440) {
        result.sidebarOut = await probe(page, ".outline", "sidebar");
        motion(result.sidebarOut, reduced, 120);
        result.sidebarIn = await probe(page, ".outline", "sidebar");
        motion(result.sidebarIn, reduced, 160);
        assert.ok(await page.locator(".workspace").evaluate(element => !getComputedStyle(element).transitionProperty.includes("grid-template-columns")), "Layout must not interpolate columns");
      } else {
        result.sidebarIn = await probe(page, ".outline", "phone-sidebar");
        motion(result.sidebarIn, reduced, 160);
        result.sidebarOut = await probe(page, ".outline", "phone-sidebar");
        motion(result.sidebarOut, reduced, 120);
      }
      const sidebarSelector = ".outline";
      const sidebarAction = width === 1440 ? "sidebar" : "phone-sidebar";
      result.sidebarReversal = await probe(page, sidebarSelector, sidebarAction, sidebarAction);
      await probe(page, sidebarSelector, sidebarAction);
      result.sidebarReopen = await probe(page, sidebarSelector, sidebarAction, sidebarAction);
      await probe(page, sidebarSelector, sidebarAction);
      if (!reduced) {
        for (const reversal of [result.sidebarReversal, result.sidebarReopen]) {
          const { before, after } = reversal.interruption;
          assert.ok(Math.abs(before.opacity - after.opacity) < 0.02);
          if (width === 1440) assert.ok(reversal.frames.every(frame => frame.proseOpacity === 1), "Sidebar reversal must never dim or blank the editor");
          assert.ok(reversal.animations.length > 0);
        }
        result.preferenceChange = await page.evaluate(async () => {
          document.querySelector('.sidebar-split').click();
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
        await page.evaluate(() => document.querySelector('.sidebar-split').click());
        assert.equal(await page.locator('.sidebar-lower').count(), 0);
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
  assert.ok(results.every((result) => result.ok), "Polish matrix failed; see out/polish-main/matrix.json");
  const context = await browser.newContext();
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
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
    await page.locator(".bar .mdbase-save-notice.is-saved:visible").waitFor();
    assert.equal(await page.locator(".bar .demo-identity").innerText(), "Demo");
    await page.waitForFunction(() => [...window.writer.workspace.getSnapshot().records.values()].every((record) => record.snapshot.state === "saved"));
    release();
    await page.reload();
    await page.getByRole("heading", { name: "This manuscript could not be opened" }).waitFor();
    assert.match(await page.locator("body").innerText(), /Demo manuscripts reset on reload/);
    await page.getByRole("button", { name: "Back to manuscripts", exact: true }).click();
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
