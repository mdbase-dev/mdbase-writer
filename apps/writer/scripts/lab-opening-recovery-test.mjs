import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { selectLabCollection } from "./lab-consent.mjs";

const origin = "https://lab.mdbase-writer.pages.dev";
const connect = "https://connect-lab.mdbase.dev";
const log = "https://mdbase-next-log-lab-20261005.callumalpass.workers.dev";
const endpoint = new URL(process.env.WRITER_LAB_CDP ?? "");
assert.ok(["127.0.0.1", "localhost"].includes(endpoint.hostname), "Use an isolated LAB desk CDP tunnel");
const collection = process.env.WRITER_LAB_COLLECTION;
const collectionName = process.env.WRITER_LAB_COLLECTION_NAME;
assert.match(collection ?? "", /^[a-f0-9-]{36}$/i);
assert.match(collectionName ?? "", /^\[test\]/);
const dist = resolve(fileURLToPath(new URL("../dist/", import.meta.url)));
const manifest = JSON.parse(readFileSync(join(dist, ".well-known/mdbase-app.json")));
assert.equal(new URL(manifest.homepage).origin, origin, "Build the verified LAB original, never retarget a production build");
const account = JSON.parse(readFileSync(join(homedir(), ".config/mdbase-lab/accounts.json"))).accounts.find(entry => entry.alias === "lab-next-acceptance");
assert.ok(account);
const browser = await chromium.connectOverCDP(endpoint.href);
const profile = browser.contexts()[0];
const health = await (await profile.request.get(`${connect}/health`)).json();
assert.equal(health.environment, "lab");
assert.equal(health.public_origin, connect);
const before = await (await profile.request.get(`${connect}/v1/me`)).json();
assert.equal(before.user.email, account.email, "Use only the registered LAB account");
assert.ok(before.native_collections.some(entry => entry.id === collection && entry.display_name === collectionName));
const existing = new Set(before.installation_access.map(entry => entry.connector_id));
const owned = new Set();
const receipts = [];

try {
  for (const fault of ["log-token", "runtime-http200"]) {
    const context = await browser.newContext({ storageState: { cookies: await profile.cookies(connect), origins: [] }, serviceWorkers: "block" });
    let broken = true;
    let failures = 0;
    let reopenRequests = 0;
    let registrations = 0;
    const foreign = new Set();
    const exchanges = [];
    context.on("response", response => {
      const url = new URL(response.url());
      if (url.origin === connect && url.pathname === "/v1/apps/register" && response.status() === 200) registrations++;
      if (url.origin === connect && /^\/v1\/pairing-requests\/[^/]+\/exchange$/.test(url.pathname) && response.ok()) {
        exchanges.push(response.json().then(value => {
          if (value.connector_id && !existing.has(value.connector_id)) owned.add(value.connector_id);
        }).catch(() => {}));
      }
    });
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        const file = resolve(dist, `.${decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname)}`);
        assert.ok(file.startsWith(`${dist}/`));
        if (!existsSync(file)) return route.fulfill({ status: 404, body: "Missing local build asset" });
        const bytes = readFileSync(file);
        if (fault === "runtime-http200" && broken && /\/runtime-[^/]+\.wasm$/.test(file)) {
          bytes[0] ^= 1;
          failures++;
        }
        const types = { ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".html": "text/html", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
        return route.fulfill({ status: 200, contentType: types[extname(file)] ?? "application/octet-stream", body: bytes });
      }
      if (![connect, log].includes(url.origin)) {
        foreign.add(url.origin);
        return route.abort();
      }
      if (url.origin === connect && url.pathname === `/v1/next/collections/${collection}/log-token`) {
        if (fault === "log-token" && broken) {
          failures++;
          return route.abort("failed");
        }
        reopenRequests++;
      }
      return route.continue();
    });
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/?collection=${encodeURIComponent(collection)}`);
      const popupPromise = page.waitForEvent("popup");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      const popup = await popupPromise;
      await popup.getByRole("button", { name: "Open mdbase writer", exact: true }).waitFor({ timeout: 60_000 });
      assert.equal(new URL(popup.url()).origin, connect);
      assert.ok((await popup.locator("body").textContent()).includes(account.email));
      const hintPreselected = await selectLabCollection(popup, collectionName);
      await popup.getByRole("button", { name: "Open mdbase writer", exact: true }).click();
      if (fault === "log-token") {
        await page.getByRole("button", { name: "Try again", exact: true }).waitFor({ timeout: 60_000 });
        assert.ok(failures > 0, "Actually fail the native opening request, not a fabricated SDK snapshot");
        assert.ok((await page.getByRole("heading", { level: 1 }).innerText()).includes(collectionName));
        assert.ok(!(await page.locator("body").innerText()).includes("couldn't be reached"));
        const documentStarted = await page.evaluate(() => performance.timeOrigin);
        broken = false;
        const started = performance.now();
        await page.getByRole("button", { name: "Try again", exact: true }).click();
        await page.locator(".home").waitFor({ timeout: 60_000 });
        assert.equal(await page.evaluate(() => performance.timeOrigin), documentStarted, "Recovery must reopen without reloading Writer");
        assert.ok(reopenRequests > 0, "The selected collection must really be opened again");
        receipts.push({ fault, hintPreselected, failures, reopenRequests, recovered: "Home", recoveryMs: Math.round(performance.now() - started) });
      } else {
        await page.getByRole("heading", { name: "Can't continue", exact: true }).waitFor({ timeout: 60_000 });
        assert.equal(failures, 1, "Exercise real runtime verification on an HTTP 200 asset response");
        assert.ok(registrations > 0, "Connect registration must really have succeeded with HTTP 200");
        assert.ok(!(await page.locator("body").innerText()).includes("couldn't be reached"));
        assert.ok((await page.locator("body").innerText()).includes("Something went wrong while opening it"));
        receipts.push({ fault, failures, registrations, networkBlame: false });
      }
      assert.deepEqual([...foreign], [], "No production, staging or other service may be contacted");
    } finally {
      await Promise.all(exchanges);
      await context.close();
    }
  }
} finally {
  for (const connector of owned) {
    const response = await profile.request.delete(`${connect}/v1/account/installations/${encodeURIComponent(connector)}`);
    assert.ok(response.ok() || response.status() === 404, "Revoke only this run's installation");
  }
  const after = await (await profile.request.get(`${connect}/v1/me`)).json();
  assert.ok(after.installation_access.every(entry => !owned.has(entry.connector_id)), "No owned grant may remain");
}
console.log(JSON.stringify({ environment: "lab", revision: health.revision, receipts, cleanup: "owned installations revoked; no records or setup changed" }));
process.exit(0);
