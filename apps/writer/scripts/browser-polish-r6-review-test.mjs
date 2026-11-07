import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:5320/";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname));
const main = "manuscripts/patient-observation.md";
const browser = await chromium.launch({ executablePath: process.env.CHROME });
let failures = 0;
async function scenario(name, run, width = 1440) {
  if (process.env.CASE && !new RegExp(process.env.CASE).test(name)) return;
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  try { await run(page); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
  finally { await context.close(); }
}
const home = async page => {
  await page.goto(`${base}?demo`);
  await page.locator(`.home [data-path="${main}"]`).waitFor();
};
const open = async page => {
  await home(page);
  await page.locator(`.home [data-path="${main}"]`).click();
  await page.locator(".cm-content").waitFor();
  await page.waitForFunction(() => window.writer.workspace.getSnapshot().indexLoad.phase === "ready");
  await page.waitForFunction(() => {
    const workspace = window.writer.workspace, snapshot = workspace.getSnapshot();
    return workspace.readingOrder().every(path => snapshot.records.has(path) || snapshot.recordProblems.has(path));
  });
};
const saved = page => page.waitForFunction(() => [...window.writer.workspace.getSnapshot().records.values()].every(record => record.snapshot.state === "saved"));
const documents = page => page.evaluate(() => [...window.writer.workspace.getSnapshot().records].map(([path, record]) => [path, record.snapshot.body]));
async function command(page, label) {
  await page.keyboard.press("Control+k");
  const input = page.locator(".mdbase-command-palette input");
  await input.waitFor();
  await page.keyboard.type(label);
  const option = page.locator('.mdbase-command-palette [role="option"]').filter({ has: page.getByText(label, { exact: true }) });
  await option.waitFor();
  const index = await option.evaluate(element => [...element.parentElement.children].filter(child => child.matches('[role="option"]')).indexOf(element));
  for (let step = 0; step < index; step++) await page.keyboard.press("ArrowDown");
  await page.waitForFunction(label => [...document.querySelectorAll('[role="option"]')].some(element => element.querySelector("strong")?.textContent === label && element.getAttribute("aria-selected") === "true"), label);
  await page.keyboard.press("Enter");
  await input.waitFor({ state: "hidden" });
}
async function clean(page) {
  await home(page);
  await page.evaluate(async () => { await (await import("/scripts/browser-a11y-fixture.tsx")).mountNative("# Clean chapter\n\nNo problems here.\n"); });
  await page.locator('.home [data-path="writing/main.md"]').click();
  await page.locator(".cm-content").waitFor();
  await page.waitForFunction(() => { const snapshot = window.writer.workspace.getSnapshot(); return snapshot.result && !snapshot.compiling; });
}
async function announcement(page, text) {
  await page.waitForFunction(text => [...document.querySelectorAll('[aria-live]')].some(element => element.textContent.includes(text) && !element.closest('[inert], [aria-hidden="true"]')), text);
}
try {
  for (const surface of ["Home", "Workspace"]) {
    await scenario(`Shared exiting dialog does not block the next shortcut on ${surface}`, async page => {
      await (surface === "Home" ? home(page) : open(page));
      const invoker = page.locator(surface === "Home" ? `.home [data-path="${main}"]` : ".cm-content");
      await invoker.focus();
      await page.keyboard.press("Control+/");
      const dialog = page.locator('.shortcuts-dialog[data-open="true"]');
      await dialog.waitFor();
      await dialog.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
      const dispatched = await dialog.evaluate(async element => {
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
        await new Promise(requestAnimationFrame);
        const exiting = element.isConnected && element.dataset.open === "false";
        const returnedFocus = document.activeElement?.matches('.home [data-path], .cm-content');
        const shortcut = new KeyboardEvent("keydown", { key: "k", code: "KeyV", ctrlKey: true, bubbles: true, cancelable: true });
        document.activeElement.dispatchEvent(shortcut);
        return { exiting, inert: element.inert, returnedFocus, handled: shortcut.defaultPrevented };
      });
      assert.equal(dispatched.exiting, true, "Exercise the actual retained shared Dialog exit");
      assert.equal(dispatched.inert, true, "The visual exit must not remain interactive");
      assert.equal(dispatched.returnedFocus, true, "Closing must return focus before the visual exit finishes");
      assert.equal(dispatched.handled, true, "An exiting dialog must not swallow the next logical shortcut");
      await page.locator('.mdbase-command-palette[data-open="true"] input').waitFor();
      assert.equal(await page.locator('.mdbase-command-palette').evaluate(element => element.parentElement === document.body), true, "Use the shared portal");
      await page.keyboard.press("Escape");
      await page.locator('.mdbase-command-palette').waitFor({ state: "detached" });
    });
  }
  for (const surface of ["Home", "Workspace"]) {
    await scenario(`Dvorak logical shortcuts toggle on ${surface}`, async page => {
      await (surface === "Home" ? home(page) : open(page));
      const dispatch = (key, code) => page.evaluate(({ key, code }) => {
        const event = new KeyboardEvent("keydown", { key, code, ctrlKey: true, bubbles: true, cancelable: true });
        (document.activeElement ?? document.body).dispatchEvent(event);
        return event.defaultPrevented;
      }, { key, code });
      const palette = page.locator(".mdbase-command-palette input");
      assert.equal(await dispatch("t", "KeyK"), false, "Dvorak Ctrl+T must not open the palette");
      await palette.waitFor({ state: "hidden" });
      assert.equal(await dispatch("k", "KeyV"), true, "Dvorak Ctrl+K opens the palette");
      await palette.waitFor();
      assert.equal(await dispatch("k", "KeyV"), true, "Dvorak Ctrl+K closes the palette");
      await palette.waitFor({ state: "hidden" });
      const shortcuts = page.locator(".shortcuts-dialog[open]");
      await dispatch("z", "Slash");
      await shortcuts.waitFor({ state: "hidden" });
      assert.equal(await dispatch("/", "BracketLeft"), true, "Dvorak Ctrl+/ opens shortcuts");
      await shortcuts.waitFor();
      assert.equal(await dispatch("/", "BracketLeft"), true, "Dvorak Ctrl+/ closes shortcuts");
      await shortcuts.waitFor({ state: "hidden" });
    });
  }
  await scenario("1 desktop Settings preserves Ctrl+comma, palette, save and F8", async page => {
    await clean(page);
    await page.locator(".cm-content").click();
    await page.keyboard.type(" SHORTCUT_SAVE ");
    await page.keyboard.press("Control+,");
    await page.locator(".settings-sheet[open]").waitFor();
    await page.evaluate(() => {
      window.saveCalls = 0;
      const workspace = window.writer.workspace, original = workspace.retrySave.bind(workspace);
      workspace.retrySave = (...args) => { window.saveCalls++; return original(...args); };
      window.savePrevented = false;
      window.addEventListener("keydown", event => { if (event.ctrlKey && event.code === "KeyS") window.savePrevented = event.defaultPrevented; }, true);
    });
    await page.keyboard.press("Control+s");
    await page.waitForFunction(() => window.saveCalls === 1 && window.savePrevented);
    await saved(page);
    await page.waitForFunction(() => !window.writer.workspace.getSnapshot().compiling);
    await page.keyboard.press("F8");
    await announcement(page, "No manuscript problems");
    await page.keyboard.press("Control+k");
    await page.locator(".mdbase-command-palette input").waitFor();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Control+,");
    await page.locator(".settings-sheet[open]").waitFor({ state: "hidden" });
  });
  for (const width of [1440, 390]) for (const preview of [false, true]) {
    await scenario(`2 Find owns real typing from ${preview ? "Preview" : "Write"} at ${width}`, async page => {
      await open(page);
      if (preview) {
        if (width === 390) await page.getByRole("button", { name: "Preview", exact: true }).click();
        else await command(page, "Preview only");
      }
      const before = await documents(page);
      const view = await page.locator(".workspace").getAttribute("class");
      const storedLayout = await page.evaluate(() => localStorage.getItem("mdbase-writer:layout"));
      if (width === 390) {
        await page.getByRole("button", { name: "More", exact: true }).click();
        await page.getByRole("menuitem", { name: "Find in chapter", exact: true }).click();
      } else await command(page, "Find in chapter");
      await page.locator('.cm-search input[name="search"]').waitFor();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.keyboard.type("NEVER_INSERT_FIND", { delay: 20 });
      assert.equal(await page.locator('.cm-search input[name="search"]').inputValue(), "NEVER_INSERT_FIND");
      assert.deepEqual(await documents(page), before);
      if (!preview && width === 1440) {
        assert.equal(await page.locator(".workspace").getAttribute("class"), view);
        assert.equal(await page.evaluate(() => localStorage.getItem("mdbase-writer:layout")), storedLayout);
      }
    }, width);
  }
  await scenario("3 slow chapter cannot hold workspace; late load preserves typing", async page => {
    await home(page);
    await page.evaluate(() => {
      const backend = window.writer.backend, original = backend.records.open.bind(backend.records);
      backend.records.open = (path, ...args) => path === "chapters/worms.md" ? new Promise(resolve => { window.finishChapter = () => original(path, ...args).then(resolve); }) : original(path, ...args);
    });
    await page.locator(`.home [data-path="${main}"]`).click();
    await page.waitForFunction(() => window.writer?.workspace?.getSnapshot().phase === "ready");
    await page.locator(".cm-content").waitFor({ timeout: 2000 });
    await page.locator(".cm-content").click();
    await page.keyboard.type(" BEFORE_LATE_CHAPTER ");
    const before = await page.locator(".cm-content").getAttribute("aria-label");
    await page.evaluate(() => window.finishChapter());
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().records.has("chapters/worms.md"));
    await page.keyboard.type("AFTER_LATE_CHAPTER");
    assert.equal(await page.locator(".cm-content").getAttribute("aria-label"), before);
    assert.ok((await documents(page)).some(([, body]) => body.includes(" BEFORE_LATE_CHAPTER AFTER_LATE_CHAPTER")));
  });
  await scenario("4 compiler failure does not announce a clean manuscript", async page => {
    await page.route("**/*.wasm*", route => route.request().resourceType() === "fetch" ? route.fulfill({ status: 200, contentType: "application/wasm", body: "invalid wasm" }) : route.continue());
    await open(page);
    await page.getByRole("alert").filter({ hasText: "The preview could not be loaded" }).waitFor({ timeout: 30000 });
    await page.locator(".cm-content").click();
    await page.keyboard.press("F8");
    await announcement(page, "Could not check manuscript problems");
    assert.equal(await page.locator('[aria-live]').filter({ hasText: "No manuscript problems" }).count(), 0);
  });
  await scenario("5 Preview-only F8 has one live announcement", async page => {
    await clean(page);
    await command(page, "Preview only");
    await page.keyboard.press("F8");
    await announcement(page, "No manuscript problems");
    assert.equal(await page.locator('[aria-live]').filter({ hasText: "No manuscript problems" }).count(), 1);
  });
  await scenario("6 phone Preview Settings returns focus to More", async page => {
    await open(page);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await page.getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page.locator(".settings-sheet[open]").waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "More");
  }, 390);
  await scenario("7 Continue retries a refused title lease once", async page => {
    await open(page);
    await command(page, "Earthworms");
    await page.locator(".cm-content").click();
    await page.keyboard.type(" TITLE_LEASE ");
    await page.evaluate(() => {
      const backend = window.writer.backend, original = backend.records.open.bind(backend.records);
      const readBody = backend.readBody.bind(backend);
      backend.readBody = path => path === "chapters/worms.md" ? Promise.resolve({ ok: true, value: backend.authority.get(path).body }) : readBody(path);
      window.titleRefused = 0;
      backend.records.open = (path, options) => {
        if (path === "chapters/worms.md" && options?.autosave === false && window.titleRefused < 2) { window.titleRefused++; return Promise.resolve({ ok: false, problem: { code: "lease_options_conflict" } }); }
        return original(path, options);
      };
    });
    await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
    await page.waitForFunction(() => window.titleRefused);
    await page.waitForFunction(() => document.querySelector(".continue-card")?.textContent.includes("Earthworms"));
  });
  await scenario("8 Continue is independent of top fifty and search uses ordinary rows", async page => {
    await home(page);
    await page.evaluate(async main => {
      const backend = window.writer.backend;
      const original = await backend.listManuscripts();
      backend.listManuscripts = async () => ({ ok: true, value: [...Array.from({ length: 55 }, (_, index) => ({ path: `other/${index}.md`, title: `Other ${index}`, modified: "2099-01-01T00:00:00Z" })), ...original.value.map(manuscript => ({ ...manuscript, modified: "2000-01-01T00:00:00Z" }))] });
      const { recordOpened } = await import("/src/ui/recent.ts");
      recordOpened("demo", main);
      window.dispatchEvent(new Event("focus"));
    }, main);
    await page.getByRole("searchbox", { name: "Find a manuscript" }).waitFor();
    await page.locator(".continue-card").waitFor();
    assert.equal(await page.locator(`.home [data-path="${main}"]`).count(), 1);
    await page.getByRole("searchbox", { name: "Find a manuscript" }).click();
    await page.keyboard.type("Patient");
    await page.locator(".continue-card").waitFor({ state: "hidden" });
    await page.locator(`.manuscript-row[data-path="${main}"]`).waitFor();
    await page.keyboard.press("Control+a"); await page.keyboard.press("Backspace");
    await page.locator(".continue-card").waitFor();
    await page.evaluate(async main => {
      const backend = window.writer.backend, manuscripts = (await backend.listManuscripts()).value;
      backend.listManuscripts = async () => ({ ok: true, value: [...manuscripts.slice(0, 50), manuscripts.find(manuscript => manuscript.path === main)] });
      window.dispatchEvent(new Event("focus"));
    }, main);
    await page.getByRole("button", { name: /Show 50 more manuscripts/ }).waitFor({ state: "hidden" });
    assert.equal(await page.locator(".manuscripts > li").count(), 51);
  });
  await scenario("9 collection count change clears quota notice without reload", async page => {
    await home(page);
    await page.evaluate(async () => { window.quotaFixture = await (await import("/scripts/browser-a11y-fixture.tsx")).mountCollectionLimit(); });
    await page.getByRole("button", { name: "Add a collection…", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Synced collection limit reached" }).waitFor();
    await page.getByRole("button", { name: "Free a collection slot", exact: true }).click();
    await page.getByRole("button", { name: "Add a collection…", exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").filter({ hasText: "Synced collection limit reached" }).count(), 0);
  });
  await scenario("10 app URL comment describes environment configuration", async () => {
    assert.doesNotMatch(readFileSync(new URL("../src/apps.ts", import.meta.url), "utf8"), /local builds point at local copies/);
  });
  await scenario("11 autosaved typing owns the active record when index arrives", async page => {
    await home(page);
    await page.evaluate(async () => {
      const backend = window.writer.backend, index = await backend.index();
      backend.index = () => new Promise(resolve => { window.finishIndex = () => resolve(index); });
    });
    await page.locator(`.home [data-path="${main}"]`).click();
    await page.locator(".cm-content").click();
    await page.keyboard.type(" BEFORE_INDEX ");
    await saved(page);
    await page.evaluate(() => window.finishIndex());
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().indexLoad.phase === "ready");
    await page.keyboard.type("AFTER_INDEX");
    await page.waitForFunction(main => window.writer.workspace.getSnapshot().records.get(main).snapshot.body.includes(" BEFORE_INDEX AFTER_INDEX"), main);
    assert.equal(await page.locator(".cm-content").getAttribute("aria-label"), `Markdown for ${main}`);
  });
  await scenario("12 adding a chapter waits for the actual index", async page => {
    await home(page);
    await page.evaluate(async () => {
      const backend = window.writer.backend, index = await backend.index();
      backend.index = () => new Promise(resolve => { window.finishIndex = () => resolve(index); });
    });
    await page.locator(`.home [data-path="${main}"]`).click();
    await page.locator(".cm-content").waitFor();
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await page.getByRole("textbox", { name: "New chapter title", exact: true }).pressSequentially("Index safety");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('input[aria-label="New chapter title"]')?.disabled || window.writer.workspace.getSnapshot().recordPaths.some(path => path.includes("index-safety")));
    assert.ok(!(await documents(page)).some(([path]) => path.includes("index-safety")), "Chapter created against an incomplete index");
    await page.evaluate(() => window.finishIndex());
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().recordPaths.includes("chapters/index-safety.md"));
    await page.waitForFunction(() => window.writer.workspace.readingOrder().includes("chapters/index-safety.md"));
    assert.ok((await documents(page)).find(([path]) => path === main)[1].includes("chapters/index-safety"));
  });
  await scenario("13 main-session loading disables mutations and preserves later chapter membership", async page => {
    await home(page);
    await page.evaluate(main => {
      const backend = window.writer.backend, original = backend.records.open.bind(backend.records);
      backend.records.open = (path, ...args) => path === main ? new Promise(resolve => { window.finishMain = () => { backend.records.open = original; return original(path, ...args).then(resolve); }; }) : original(path, ...args);
      const create = backend.createRecord.bind(backend);
      window.createdChapters = 0;
      backend.createRecord = (...args) => { window.createdChapters++; return create(...args); };
    }, main);
    await page.locator(`.home [data-path="${main}"]`).click();
    await page.locator(".workspace .outline-panel").waitFor();
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().indexLoad.phase === "ready");
    const add = page.getByRole("button", { name: "Add chapter", exact: true });
    assert.equal(await add.isDisabled(), true, "Add is enabled before the manuscript session opens");
    await page.getByText("The manuscript is still opening.", { exact: true }).waitFor();
    await page.locator(".outline-manuscript").click();
    await page.keyboard.type("NOT_EDITABLE_YET");
    await page.keyboard.press("Delete");
    await page.keyboard.press("Alt+ArrowDown");
    await page.keyboard.press("F2");
    await page.keyboard.press("Control+,");
    assert.equal(await page.locator(".cm-content, .record-row, .record-rename, .settings-sheet[open]").count(), 0);
    assert.equal(await page.getByRole("button", { name: /Delete chapter|Remove chapter/ }).count(), 0);
    assert.equal(await page.evaluate(() => window.createdChapters), 0);
    await page.evaluate(() => window.finishMain());
    await page.waitForFunction(main => window.writer.workspace.getSnapshot().records.has(main), main);
    await page.waitForFunction(() => !document.querySelector(".add-chapter")?.disabled);
    await page.locator(".settings-sheet[open]").waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".settings-sheet[open]").waitFor({ state: "hidden" });
    await page.locator(".outline-manuscript").click();
    await page.locator(".cm-content").click();
    await page.keyboard.type(" MAIN_SESSION_READY ");
    await saved(page);
    await add.click();
    await page.keyboard.type("Session safety");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.writer.workspace.chapterPaths().includes("chapters/session-safety.md"));
    await saved(page);
    await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
    await page.locator(`.home [data-path="${main}"]`).click();
    await page.locator('.record-row[data-path="chapters/session-safety.md"]').waitFor();
    assert.ok(await page.evaluate(main => window.writer.workspace.getSnapshot().records.get(main).snapshot.body.includes(" MAIN_SESSION_READY "), main));
    assert.ok(await page.evaluate(() => window.writer.workspace.readingOrder().includes("chapters/session-safety.md")));
  });
  await scenario("13b a stale Add form reports a missing main session without creating an orphan", async page => {
    await open(page);
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await page.keyboard.type("Stale action safety");
    await page.evaluate(main => {
      const workspace = window.writer.workspace;
      workspace.leases.get(main).lease.release();
      workspace.leases.delete(main);
      window.createdChapters = 0;
      const backend = window.writer.backend, create = backend.createRecord.bind(backend);
      backend.createRecord = (...args) => { window.createdChapters++; return create(...args); };
    }, main);
    await page.keyboard.press("Enter");
    await page.locator('.add-chapter-form [role="alert"]').filter({ hasText: "The manuscript is still opening." }).waitFor();
    assert.equal(await page.evaluate(() => window.createdChapters), 0);
    assert.ok(!(await documents(page)).some(([path]) => path.includes("stale-action-safety")));
  });
  await scenario("14 ready watch index unblocks Add before obsolete request completes", async page => {
    await home(page);
    await page.evaluate(async () => {
      const backend = window.writer.backend, original = backend.index.bind(backend), index = await original(), subscribe = backend.onCollectionChange.bind(backend);
      window.originalPaths = index.value.recordPaths;
      await backend.createRecord("chapters/watch-only.md", "# Watched chapter\n\nExternal text.\n");
      await backend.flushChanges();
      const newer = await original();
      backend.index = () => new Promise(resolve => { window.finishIndex = () => { backend.index = original; resolve(index); }; });
      backend.onCollectionChange = listener => {
        window.deliverIndex = () => listener({ paths: [], index: newer.value });
        return subscribe(listener);
      };
    });
    await page.locator(`.home [data-path="${main}"]`).click();
    await page.locator(".cm-content").waitFor();
    await page.evaluate(() => window.deliverIndex());
    await page.waitForFunction(() => window.writer.workspace.getSnapshot().indexLoad.phase === "ready");
    await page.getByRole("button", { name: "Add chapter", exact: true }).click();
    await page.keyboard.type("Watch index safety");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.writer.workspace.chapterPaths().includes("chapters/watch-index-safety.md"), null, { timeout: 3000 });
    assert.ok(await page.evaluate(() => window.writer.workspace.readingOrder().includes("chapters/watch-index-safety.md")));
    assert.ok(await page.evaluate(() => window.originalPaths.every(path => window.writer.workspace.getSnapshot().recordPaths.includes(path))));
    await page.evaluate(async () => { window.finishIndex(); await window.writer.workspace.metadataJobs.indexLoad; });
    assert.ok(await page.evaluate(() => window.writer.workspace.getSnapshot().recordPaths.includes("chapters/watch-only.md")));
    await saved(page);
    await page.getByRole("button", { name: "Manuscripts", exact: true }).click();
    await page.locator(`.home [data-path="${main}"]`).click();
    await page.locator('.record-row[data-path="chapters/watch-index-safety.md"]').waitFor();
  });
} finally { await browser.close(); }
assert.equal(failures, 0, `${failures} review regression gates failed`);
