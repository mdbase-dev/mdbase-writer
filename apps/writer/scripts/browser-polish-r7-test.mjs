import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadavg } from "node:os";
import { chromium } from "playwright";

assert.ok(loadavg()[0] < 20, "Browser measurements require local load below 20");
const base = process.env.BASE ?? "http://127.0.0.1:5327/";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const browser = await chromium.launch({ executablePath: process.env.CHROME });
const measurements = {};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}?demo`);
  await page.locator('.home [data-path="manuscripts/patient-observation.md"]').waitFor();
  await page.evaluate(() => { window.openedAt = performance.now(); });
  await page.locator('.home [data-path="manuscripts/patient-observation.md"]').click();
  await page.waitForFunction(() => document.querySelector('.preview canvas[data-version]'), null, { timeout: 60000 });
  measurements.firstInkMs = await page.evaluate(() => performance.now() - window.openedAt);
  measurements.paletteCommands = await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true }));
    return 0;
  });
  await page.locator('.mdbase-command-palette [role="option"]').first().waitFor();
  measurements.paletteCommands = await page.locator('.mdbase-command-palette [role="option"]').count();
  await page.keyboard.press("Control+k");
  await page.locator('.mdbase-command-palette').waitFor({ state: "hidden" });
  await page.waitForFunction(() => {
    const snapshot = window.writer.workspace.getSnapshot();
    return !snapshot.compiling && Number(document.querySelector('.preview-pages')?.dataset.renderedRevision) === snapshot.artifactRevision;
  });
  await page.evaluate(() => { window.roundSevenSemantics = [...document.querySelectorAll('.text-layer')].map(layer => layer.firstElementChild); window.roundSevenArtifactRevision = window.writer.workspace.getSnapshot().artifactRevision; });
  measurements.transitions = [];
  for (let iteration = 0; iteration < 4; iteration++) {
    await page.evaluate(() => {
      window.motion = { frames: [], tasks: [], draws: [] };
      window.motionStart = undefined;
      const start = event => {
        if (event.ctrlKey && event.code === "Backslash") {
          window.motionStart = performance.now();
          window.removeEventListener("keydown", start, true);
        }
      };
      window.addEventListener("keydown", start, true);
      window.taskObserver = new PerformanceObserver(list => window.motion.tasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration }))));
      window.taskObserver.observe({ type: "longtask" });
      window.drawObserver = new MutationObserver(records => {
        if (window.motionStart !== undefined) window.motion.draws.push(...records.map(record => ({ time: performance.now() - window.motionStart, page: record.target.dataset.page, attribute: record.attributeName })));
      });
      document.querySelectorAll('.preview canvas').forEach(canvas => window.drawObserver.observe(canvas, { attributes: true }));
      const sample = () => {
        const elapsed = window.motionStart === undefined ? undefined : performance.now() - window.motionStart;
        if (elapsed !== undefined) window.motion.frames.push({ time: elapsed, opacity: Number(getComputedStyle(document.querySelector('.write')).opacity) });
        if (elapsed === undefined || elapsed < 400) requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
    await page.keyboard.press("Control+Backslash");
    await page.waitForFunction(() => window.motion.frames.at(-1)?.time >= 400);
    measurements.transitions.push(await page.evaluate(() => {
      window.taskObserver.disconnect(); window.drawObserver.disconnect();
      return { ...window.motion, maxTaskMs: Math.max(0, ...window.motion.tasks.map(task => task.duration)), firstFadeMs: window.motion.frames.find(frame => frame.opacity < .99)?.time ?? null };
    }));
  }
  const semantics = await page.evaluate(() => ({ beforeRevision: window.roundSevenArtifactRevision, afterRevision: window.writer.workspace.getSnapshot().artifactRevision, pages: [...document.querySelectorAll('.text-layer')].map((layer, index) => ({ page: index, hadNode: Boolean(window.roundSevenSemantics[index]), hasNode: Boolean(layer.firstElementChild), same: layer.firstElementChild === window.roundSevenSemantics[index] })) }));
  measurements.semantics = semantics;
  const results = process.env.RESULTS ?? "out/polish-r7.json";
  mkdirSync(dirname(results), { recursive: true });
  writeFileSync(results, JSON.stringify(measurements, null, 2));
  console.log(JSON.stringify(measurements));
  assert.equal(semantics.beforeRevision, semantics.afterRevision, "The semantic identity sample must keep the same document revision");
  assert.ok(semantics.pages.some(page => page.hadNode) && semantics.pages.every(page => !page.hadNode || page.same), `Size-only redraw must preserve rendered semantic DOM identity: ${JSON.stringify(semantics)}`);
  await page.keyboard.press("Control+/");
  await page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }).waitFor();
  assert.equal(await page.locator(".shortcuts dt").filter({ hasText: /^Ctrl\+F$/ }).count(), 1);
  await page.keyboard.press("Control+/");
  await page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }).waitFor({ state: "hidden" });
  for (const label of ["Add chapter", "New manuscript", "Retry preview", "Sources", "Comments", "Outline"]) {
    await page.keyboard.press("Control+k");
    await page.locator('.mdbase-command-palette input').fill(label);
    await page.locator('.mdbase-command-palette [role="option"]').filter({ has: page.getByText(label, { exact: true }) }).waitFor();
    await page.keyboard.press("Control+k");
    await page.locator('.mdbase-command-palette').waitFor({ state: "hidden" });
  }
  await page.getByRole("button", { name: "Preview only", exact: true }).click();
  await page.locator('.write').waitFor({ state: "hidden" });
  assert.equal(await page.locator('.write').evaluate(element => element.getAnimations().length), 0);
  await page.getByRole("button", { name: "Editor only", exact: true }).click();
  await page.locator('.preview-pane').waitFor({ state: "hidden" });
  assert.equal(await page.locator('.preview-pane').evaluate(element => element.getAnimations().length), 0);
  const hiddenRevision = await page.evaluate(() => {
    window.hiddenPreviewDraws = [];
    window.hiddenPreviewObserver = new MutationObserver(records => window.hiddenPreviewDraws.push(...records.map(record => record.attributeName)));
    document.querySelectorAll('.preview canvas').forEach(canvas => window.hiddenPreviewObserver.observe(canvas, { attributes: true }));
    return window.writer.workspace.getSnapshot().artifactRevision;
  });
  await page.locator('.cm-content').focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" [test] hidden preview ");
  await page.waitForFunction(revision => { const snapshot = window.writer.workspace.getSnapshot(); return !snapshot.compiling && snapshot.artifactRevision > revision; }, hiddenRevision);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => { window.hiddenPreviewObserver.disconnect(); return window.hiddenPreviewDraws.length; }), 0, "A new artifact must not redraw a hidden preview");
  await page.keyboard.press("Control+k");
  await page.locator('.mdbase-command-palette input').fill("Add chapter");
  await page.locator('.mdbase-command-palette [role="option"]').filter({ has: page.getByText("Add chapter", { exact: true }) }).click();
  await page.getByRole("textbox", { name: "New chapter title", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const workspace = window.writer.workspace;
    window.roundSevenRetrySave = workspace.retrySave.bind(workspace);
    workspace.retrySave = async () => ({ ok: false, message: "[test] save unavailable" });
  });
  await page.keyboard.press("Control+k");
  await page.locator('.mdbase-command-palette input').fill("New manuscript");
  await page.locator('.mdbase-command-palette [role="option"]').filter({ has: page.getByText("New manuscript", { exact: true }) }).click();
  await page.getByRole("dialog", { name: "Some changes are not saved", exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog", { name: "New manuscript", exact: true }).count(), 0);
  await page.evaluate(() => { window.writer.workspace.retrySave = window.roundSevenRetrySave; });
  await page.getByRole("button", { name: "Retry saving", exact: true }).click();
  await page.getByRole("dialog", { name: "New manuscript", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog", { name: "New manuscript", exact: true }).waitFor({ state: "hidden" });
  await page.locator('.home').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("?");
  await page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }).waitFor();
  await page.keyboard.press("Control+/");
  await page.getByRole("dialog", { name: "Keyboard shortcuts", exact: true }).waitFor({ state: "hidden" });
  console.log("PASS Home help, palette/help toggles, existing commands, and hidden preview motion");
  for (const colorScheme of ["light", "dark"]) {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme, reducedMotion });
      try {
        await phone.goto(`${base}?demo`);
        await phone.locator('.home [data-path="manuscripts/patient-observation.md"]').click();
        await phone.locator('.preview canvas').first().waitFor({ state: "attached" });
        assert.equal(await phone.locator('.preview').evaluate(element => element.checkVisibility({ visibilityProperty: true })), false);
        assert.equal(await phone.locator('.preview canvas[data-version]').count(), 0, "Phone must not draw hidden preview pages");
        await phone.locator('.pane-tabs button').last().click();
        await phone.waitForFunction(() => {
          const snapshot = window.writer.workspace.getSnapshot();
          return document.querySelector('.preview canvas[data-version]') && Number(document.querySelector('.preview-pages')?.dataset.renderedRevision) === snapshot.artifactRevision;
        }, null, { timeout: 60000 });
        console.log(`PASS phone hidden preview draws after opening ${colorScheme}/${reducedMotion}`);
      } finally { await phone.close(); }
    }
  }
  assert.ok(measurements.transitions.every(transition => transition.maxTaskMs < 50), "Sidebar must not create a long task");
  assert.ok(measurements.transitions.every(transition => transition.firstFadeMs !== null && transition.firstFadeMs < 50), "Sidebar fade must start within one frame plus input delivery");
  assert.ok(measurements.transitions.every(transition => transition.draws.every(draw => draw.time >= 160)), "Preview drawing must wait for the sidebar transition");
  assert.ok(measurements.transitions.every(transition => {
    const pages = transition.draws.filter(draw => draw.attribute === "data-version").map(draw => draw.page);
    return new Set(pages).size === pages.length;
  }), "Each page redraws at most once for a sidebar layout");
} finally { await browser.close(); }
