// Asserts that a Writer build talks only to its target environment's Connect.
//
//   node scripts/verify-connect-target.mjs [lab|staging|production] [dist]
//   node scripts/verify-connect-target.mjs <lab|staging|production> --origin https://staging.mdbase-writer.pages.dev
//
// Without a target it requires the build environment selected by
// VITE_MDBASE_ENV/MDBASE_ENV, as `pnpm build` does.
//
// The first form scans every built JavaScript file; the second fetches the
// served page and the scripts it loads. Both refuse unless the SDK's packaged
// release trust names the target's Connect origin and no other Connect origin
// appears in the bundle.
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { writerDeployments } from "./deployment-environment.mjs";
import { writerSdkTarget } from "./writer-sdk.mjs";

const connectLiteral = /https:\/\/connect(?:-[a-z0-9]+)?\.mdbase\.dev(?![a-z0-9.-])/gu;
const appLiteral = /https:\/\/(?:(?:editor|reader|writer)(?:-[a-z0-9]+)?\.mdbase\.dev|(?:[a-z0-9]+\.)?mdbase-(?:editor|reader|writer)\.pages\.dev)(?![a-z0-9.-])/gu;
// The SDK's compiled release trust, e.g. environment:`staging`,cpOrigin:`https://…`.
const packagedTrust = /environment:\s*["'`]([a-z]+)["'`]\s*,\s*cpOrigin:\s*["'`]([^"'`]+)["'`]/gu;

const quoted = (value) => `["'\x60]${value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}["'\x60]`;
const originEntries = Object.entries(writerDeployments).map(([environment, deployment]) =>
  `["']?${environment}["']?\\s*:\\s*${quoted(deployment.origin)}`);
const originDeclaration = new RegExp(`\\{\\s*${originEntries.join("\\s*,\\s*")}\\s*\\}`, "gu");
const installationDeclaration = new RegExp(`installation_origins["']?\\s*:\\s*\\{\\s*${Object.entries(writerDeployments).map(([environment, deployment]) =>
  `["']?${environment}["']?\\s*:\\s*\\{\\s*["']app-runtime["']\\s*:\\s*\\[\\s*${quoted(deployment.origin)}\\s*\\]\\s*\\}`,
).join("\\s*,\\s*")}\\s*\\}`, "gu");

/** Connect origins and packaged SDK release trusts found in bundle sources. */
export function connectTargetsIn(sources) {
  const origins = new Set();
  const trusts = [];
  for (const source of sources) {
    for (const [origin] of source.matchAll(connectLiteral)) origins.add(origin);
    for (const [, environment, cpOrigin] of source.matchAll(packagedTrust)) {
      trusts.push({ environment, cpOrigin });
      origins.add(cpOrigin);
    }
  }
  return { origins: [...origins].sort(), trusts };
}

export function assertConnectTarget(target, sources) {
  const deployment = writerDeployments[target];
  if (!deployment) throw new Error(`Unsupported Writer target: ${target}.`);
  const expected = deployment.connectUrl;
  const { origins, trusts } = connectTargetsIn(sources);
  if (trusts.length === 0) throw new Error("No packaged SDK release trust found in the bundle; cannot confirm its Connect target.");
  const wrong = trusts.filter((trust) => trust.environment !== target || trust.cpOrigin !== expected);
  if (wrong.length > 0) {
    throw new Error(`${target} Writer bundle packages ${wrong.map((t) => `${t.environment} trust for ${t.cpOrigin}`).join(", ")}; expected ${target} trust for ${expected}.`);
  }
  const foreign = origins.filter((origin) => origin !== expected);
  if (foreign.length > 0) throw new Error(`${target} Writer bundle references Connect ${foreign.join(", ")}; only ${expected} is allowed.`);
  const allowedApps = new Set([deployment.origin, deployment.editorUrl, deployment.readerUrl]);
  const destinations = sources.map(source => source.replace(installationDeclaration, "").replace(originDeclaration, ""));
  const foreignApps = [...new Set(destinations.flatMap(source => [...source.matchAll(appLiteral)].map(([origin]) => origin)))].filter(origin => !allowedApps.has(origin));
  if (foreignApps.length > 0) throw new Error(`${target} Writer bundle references foreign apps ${foreignApps.join(", ")}.`);
  return { target, connectOrigin: expected, trusts: trusts.length };
}

async function builtSources(dist) {
  const out = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(?:m?js|cjs)$/u.test(entry.name)) out.push(await readFile(path, "utf8"));
    }
  }
  await walk(dist);
  return out;
}

async function servedSources(origin) {
  const get = async (url) => {
    const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(30_000), headers: { "cache-control": "no-cache" } });
    if (!response.ok) throw new Error(`GET ${url} returned HTTP ${response.status}.`);
    return response.text();
  };
  const page = await get(`${origin}/`);
  const scripts = [...page.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+\.m?js)"/gu)].map(([, src]) => new URL(src, `${origin}/`));
  if (!scripts.some((url) => url.origin === origin)) throw new Error(`${origin}/ loads no same-origin scripts.`);
  return Promise.all(scripts.filter((url) => url.origin === origin).map((url) => get(url.href)));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const target = Object.hasOwn(writerDeployments, args[0] ?? "") ? args.shift() : writerSdkTarget(process.env);
  if (target === undefined) {
    throw new Error("Select VITE_MDBASE_ENV (lab, staging or production) before verifying a Writer build.");
  }
  const rest = args;
  const originIndex = rest.indexOf("--origin");
  const sources =
    originIndex >= 0
      ? await servedSources(new URL(rest[originIndex + 1]).origin)
      : await builtSources(resolve(rest[0] ?? resolve(import.meta.dirname, "..", "dist")));
  const result = assertConnectTarget(target, sources);
  console.log(`Writer ${result.target} bundle targets Connect ${result.connectOrigin} only.`);
}
