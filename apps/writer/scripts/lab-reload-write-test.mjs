import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const origin = "https://lab.mdbase-writer.pages.dev";
const connect = "https://connect-lab.mdbase.dev";
const collection = process.env.WRITER_LAB_COLLECTION;
const collectionName = process.env.WRITER_LAB_COLLECTION_NAME;
const manuscript = process.env.WRITER_LAB_MANUSCRIPT;
assert.match(collection ?? "", /^[a-f0-9-]{36}$/i, "WRITER_LAB_COLLECTION must name your LAB fixture");
assert.ok(manuscript, "WRITER_LAB_MANUSCRIPT must name your owned [test] manuscript");
assert.match(collectionName ?? "", /^\[test\]/i, "WRITER_LAB_COLLECTION_NAME must name your owned test collection");
const endpoint = new URL(process.env.WRITER_LAB_CDP ?? "");
assert.ok(["127.0.0.1", "localhost"].includes(endpoint.hostname), "Use the isolated GCP desk CDP tunnel");
const registry = JSON.parse(readFileSync(join(homedir(), ".config/mdbase-lab/accounts.json")));
const account = registry.accounts.find(entry => entry.alias === "lab-next-acceptance");
assert.ok(account, "Registered LAB alias required");
const browser = await chromium.connectOverCDP(endpoint.href);
const context = browser.contexts()[0];
const health = await (await context.request.get(`${connect}/health`)).json();
assert.equal(health.environment, "lab");
assert.equal(health.public_origin, connect);
console.log(JSON.stringify({ environment: health.environment, revision: health.revision, engine: health.engine ?? null }));
const url = `${origin}/?collection=${encodeURIComponent(collection)}`;
const ownedPages = [];
let clean;
let original;
let changed = false;
const page = await context.newPage();
ownedPages.push(page);

async function ready(target) {
  await target.waitForFunction(() => document.querySelector(".home") || [...document.querySelectorAll("button")].some(button => button.textContent === "Sign in"), null, { timeout: 60_000 });
  if (!await target.locator(".home").count()) {
    const popupPromise = target.waitForEvent("popup");
    await target.getByRole("button", { name: "Sign in", exact: true }).click();
    const popup = await popupPromise;
    ownedPages.push(popup);
    await popup.getByRole("button", { name: "Open mdbase writer", exact: true }).waitFor({ timeout: 60_000 });
    assert.equal(new URL(popup.url()).origin, connect);
    assert.ok((await popup.locator("body").textContent()).includes(account.email), "Registered LAB account must be signed in on the desk");
    const choice = popup.getByRole("checkbox", { name: new RegExp(collectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) });
    assert.equal(await choice.count(), 1, "The owned test collection must be an unambiguous consent choice");
    console.log(`Collection hint preselected: ${await choice.isChecked()}`);
    await choice.check();
    assert.equal(await popup.locator('input[type="checkbox"]:checked').count(), 1, "Never approve additional collections");
    await popup.getByRole("button", { name: "Open mdbase writer", exact: true }).click();
  }
  await target.waitForFunction(expected => window.writer?.backend?.draftNamespace === expected, collection, { timeout: 60_000 });
}

async function writeBody(body) {
  const outcome = await page.evaluate(async ({ manuscript, body }) => {
    const opened = await window.writer.backend.records.open(manuscript, { autosave: false });
    if (!opened.ok) return false;
    try { opened.value.session.setBody(body); return (await opened.value.session.flush({ timeoutMs: 30_000 })).ok; }
    finally { opened.value.release(); }
  }, { manuscript, body });
  assert.equal(outcome, true, "Writer must receive the actual SDK save acknowledgement");
}

try {
  await page.goto(url);
  await ready(page);
  const fixture = await page.evaluate(async manuscript => {
    const result = await window.writer.backend.listManuscripts();
    return result.ok ? result.value.find(entry => entry.path === manuscript) : null;
  }, manuscript);
  assert.match(fixture?.title ?? "", /^\[test\]/i, "Only an owned [test] manuscript may be changed");
  const read = await page.evaluate(manuscript => window.writer.backend.readBody(manuscript), manuscript);
  assert.equal(read.ok, true);
  original = read.value;
  await page.reload();
  await ready(page);
  const marker = `[test] reload-write ${crypto.randomUUID()}`;
  changed = true;
  await writeBody(`${original}\n\n${marker}\n`);
  const cookies = await context.cookies(connect);
  clean = await browser.newContext({ storageState: { cookies, origins: [] } });
  const reader = await clean.newPage();
  await reader.goto(url);
  await ready(reader);
  const readback = await reader.evaluate(manuscript => window.writer.backend.readBody(manuscript), manuscript);
  assert.equal(readback.ok, true);
  assert.ok(readback.value.includes(marker), "A fresh Writer context must read the server-confirmed change");
  console.log("PASS reload → acknowledged write → clean-session readback");
} finally {
  try {
    if (changed) { await writeBody(original); console.log("Restored owned fixture body"); }
  } finally {
    await clean?.close();
    for (const owned of ownedPages) if (!owned.isClosed()) await owned.close();
  }
}
process.exit(0);
