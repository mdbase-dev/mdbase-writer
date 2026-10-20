// No credentials, redirects, rebuilds, rollback or redeploy. Compare the saved
// pre-upload inventory with the real target alias, including every JS/trust,
// native, SQLite, HTML and manifest byte. Bounds also cover response bodies.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { assertInventoryCoverage } from "./native-publisher.mjs";

const pagesInternal = new Set(["_routes.json", "_headers", "_redirects"]);
export const isFetchableAsset = (path) => !pagesInternal.has(path) && path !== "_worker.js" && !path.startsWith("_worker.js/");

export function servedUrlFor(origin, path) {
  const segments = path.split("/").map(encodeURIComponent);
  if (segments.at(-1) === "index.html") segments[segments.length - 1] = "";
  else if (segments.at(-1).endsWith(".html")) segments[segments.length - 1] = segments.at(-1).slice(0, -5);
  return `${origin.replace(/\/$/u, "")}/${segments.join("/")}`;
}

const defaultSleep = (ms, signal) => delay(ms, undefined, { signal });
async function readBounded(response, limit, signal) {
  if (!response.body?.getReader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error("response body exceeds expected size bound");
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error("response body exceeds expected size bound");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally { await reader.cancel().catch(() => {}); }
}

export async function verifyServedAssets({ origin, inventory, fetchImpl = fetch, sleepImpl = defaultSleep,
  attempts = 6, delayMs = 5000, maxAssets = 1024, maxBytesPerAsset = 25 * 1024 * 1024,
  totalTimeoutMs = 240000, requestTimeoutMs = 15000 }) {
  assertInventoryCoverage(inventory);
  const expectedOrigin = new URL(origin);
  if (expectedOrigin.origin !== origin || !["https://staging.mdbase-writer.pages.dev", "https://writer.mdbase.dev"].includes(origin)) throw new Error("Refusing non-target verification origin");
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 12 || totalTimeoutMs < 1 || totalTimeoutMs > 300000 || requestTimeoutMs < 1 || requestTimeoutMs > 30000 || delayMs < 0 || delayMs > 10000) throw new Error("Invalid verification attempt/time bound");
  const fetchable = inventory.filter((a) => isFetchableAsset(a.path));
  if (fetchable.length > maxAssets || fetchable.some((a) => a.bytes > maxBytesPerAsset)) throw new Error("Served-byte verification asset bound exceeded");
  const deadline = AbortSignal.timeout(totalTimeoutMs);
  let mismatches = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    mismatches = [];
    for (const asset of fetchable) {
      const url = servedUrlFor(origin, asset.path);
      try {
        deadline.throwIfAborted();
        const signal = AbortSignal.any([deadline, AbortSignal.timeout(requestTimeoutMs)]);
        const response = await fetchImpl(url, { signal, redirect: "manual", cache: "no-store", headers: { "Cache-Control": "no-cache" } });
        if (response.url && response.url !== url) throw new Error("response URL differs from requested target path");
        // Pages' custom 404 document may be served with its intended status.
        if (response.status !== 200 && !(asset.path === "404.html" && response.status === 404)) throw new Error(`HTTP ${response.status}`);
        const bytes = await readBounded(response, asset.bytes, signal);
        const actualSha256 = createHash("sha256").update(bytes).digest("hex");
        if (bytes.length !== asset.bytes || actualSha256 !== asset.sha256) throw new Error(`served bytes differ from built bytes (sha256 ${actualSha256})`);
      } catch (error) {
        mismatches.push({ path: asset.path, reason: error.message, expectedSha256: asset.sha256 });
      }
      if (deadline.aborted) return { ok: false, checked: fetchable.length, attemptsUsed: attempt, timedOut: true, mismatches };
    }
    if (!mismatches.length) return { ok: true, checked: fetchable.length, attemptsUsed: attempt, mismatches: [] };
    if (attempt < attempts) {
      try { await sleepImpl(delayMs, deadline); }
      catch (error) { return { ok: false, checked: fetchable.length, attemptsUsed: attempt, timedOut: deadline.aborted, mismatches, error: error.message }; }
    }
  }
  return { ok: false, checked: fetchable.length, attemptsUsed: attempts, mismatches };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 2) args[argv[i].slice(2)] = argv[i + 1];
  try {
    if (!args.origin || !args.inventory) throw new Error("Usage: verify-served.mjs --origin <target-origin> --inventory <pre-upload-inventory.json>");
    const inventory = JSON.parse(await readFile(resolve(args.inventory), "utf8"));
    const result = await verifyServedAssets({ origin: args.origin, inventory });
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, error: error.message }));
    process.exitCode = 1;
  }
}
