// Selects the per-environment SDK original a Writer build compiles against.
//
// Each SDK archive packages exactly one environment's release trust (its
// Connect and log origins), so the environment of a build is decided by which
// archive is bundled, not by VITE_MDBASE_CONNECT_URL. The lab, staging and
// production originals stay installed side by side (`@mdbase-dev/sdk-lab`,
// `@mdbase-dev/sdk-staging`, `@mdbase-dev/sdk`), as in mdbase Reader. A build
// for one environment refuses an SDK packaged for another; it never falls back.
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { installedMembers, originalMembers } from "../../../scripts/publisher/originals.mjs";
import { writerDeployments } from "./deployment-environment.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Intake pins (under vendor/) for each environment's SDK original. */
export const writerSdkPins = Object.freeze({
  lab: "sdk-lab-beta157.json",
  staging: "sdk-staging-beta157.json",
  production: "sdk-production-beta168.json",
});

/** Installed package names to try, in order. The plain name comes first so a
 * native release branch, which installs its target's original as
 * `@mdbase-dev/sdk`, keeps using exactly that package. */
const candidates = (target) => ["@mdbase-dev/sdk", `@mdbase-dev/sdk-${target}`];

/**
 * The explicit build environment, or undefined when none is selected (local
 * development and unit tests, which never construct the native entry).
 * Refuses unknown or conflicting selectors and a Connect origin that is not
 * the selected environment's.
 */
export function writerSdkTarget(environment) {
  const selectors = [environment.VITE_MDBASE_ENV, environment.MDBASE_ENV, environment.MDBASE_WRITER_DEPLOY_TARGET].filter(
    (value) => value !== undefined && value !== "",
  );
  if (selectors.some((value) => value !== selectors[0])) {
    throw new Error(`Conflicting Writer build environments (${[...new Set(selectors)].join(", ")}); refusing to build.`);
  }
  const target = selectors[0];
  if (target === undefined) {
    if (environment.VITE_MDBASE_CONNECT_URL) {
      throw new Error("VITE_MDBASE_CONNECT_URL is set without VITE_MDBASE_ENV; select the Writer build environment explicitly.");
    }
    return undefined;
  }
  if (!Object.hasOwn(writerDeployments, target)) throw new Error(`Unsupported Writer build environment: ${target}.`);
  const expected = writerDeployments[target].connectUrl;
  for (const name of ["VITE_MDBASE_CONNECT_URL", "MDBASE_CONNECT_URL"]) {
    const value = environment[name];
    if (value !== undefined && value !== "" && value !== expected) {
      throw new Error(`${target} Writer requires Connect ${expected}, but ${name} is ${value}; refusing to build.`);
    }
  }
  return target;
}

/** Release metadata the SDK compiles in (dist/application/packaged-trust.js). */
export function packagedRelease(moduleSource) {
  const match = /^const metadata = (\{.*\});$/mu.exec(moduleSource);
  if (!match) throw new Error("Unknown SDK packaged-trust format; refusing to build.");
  return JSON.parse(match[1]);
}

async function installedRoot(app, name) {
  const path = join(app, "node_modules", ...name.split("/"));
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

/**
 * Finds the installed SDK packaged for `target`, verifies it is byte-for-byte
 * the pinned original archive for that environment and that its packaged
 * Connect origin is the environment's, and returns Vite aliases for it.
 */
export async function verifiedWriterSdk(target, root = repoRoot, app = join(root, "apps/writer")) {
  if (!Object.hasOwn(writerSdkPins, target)) throw new Error(`Unsupported Writer build environment: ${target}.`);
  const expectedConnect = writerDeployments[target].connectUrl;
  const planPath = process.env.WRITER_PUBLICATION_PLAN;
  const plan = planPath ? JSON.parse(await readFile(planPath, "utf8")) : undefined;
  if (plan && plan.target !== target) throw new Error("Publication plan target mismatch");
  const pin = plan ? {
    environment: target, trust: { environment: target, cpOrigin: plan.sdkTrust.release.cpOrigin,
      logOrigin: plan.sdkTrust.release.logOrigin, sha256: plan.sdkTrust.release.assetSha256 },
    artifact: target === "staging" ? "sdk-staging.tgz" : plan.sdkTrust.production.path.slice("vendor/".length),
    ...plan.sdkTrust.archives.sdk,
  } : JSON.parse(await readFile(join(root, "vendor", writerSdkPins[target]), "utf8"));
  const pinTrust = pin.trust ?? pin.provenance?.trust;
  if (pin.environment !== target || (pinTrust?.environment ?? pin.environment) !== target || pinTrust?.cpOrigin !== expectedConnect) {
    throw new Error(`vendor/${writerSdkPins[target]} is not the ${target} SDK for ${expectedConnect}; refusing to build.`);
  }

  const seen = [];
  for (const name of candidates(target)) {
    const sdkRoot = await installedRoot(app, name);
    if (!sdkRoot) continue;
    const release = packagedRelease(await readFile(join(sdkRoot, "dist/application/packaged-trust.js"), "utf8"));
    seen.push(`${name} (${release.environment}, ${release.cpOrigin})`);
    if (release.environment !== target) continue;
    if (release.cpOrigin !== expectedConnect) {
      throw new Error(`${name} is packaged for ${target} with Connect ${release.cpOrigin}, not ${expectedConnect}; refusing to build.`);
    }
    if (release.logOrigin !== pinTrust.logOrigin || release.assetSha256 !== pinTrust.sha256) {
      throw new Error(`${name} release trust differs from vendor/${writerSdkPins[target]}; refusing to build.`);
    }
    const archive = join(root, "vendor", pin.artifact);
    const bytes = await readFile(archive);
    if (bytes.length !== pin.bytes || hash(bytes) !== pin.sha256) throw new Error(`vendor/${pin.artifact} does not match its pin; refusing to build.`);
    const expected = originalMembers(archive).map(({ path, bytes: length, sha256 }) => `${path}\0${length}\0${sha256}`);
    const actual = (await installedMembers(sdkRoot)).map(({ path, bytes: length, sha256 }) => `${path}\0${length}\0${sha256}`);
    const missing = expected.filter((member) => !actual.includes(member));
    if (missing.length > 0) {
      throw new Error(`${name} is not the original ${pin.artifact} (${missing[0].split("\0")[0]} differs); refusing to build.`);
    }
    const pkg = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8"));
    const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    return {
      target,
      name,
      root: sdkRoot,
      // Exact specifiers only, so every importer (Writer and its dependencies)
      // resolves this environment's SDK. Not needed when it is already the
      // plain package, but harmless and explicit.
      aliases: Object.entries(pkg.exports).flatMap(([key, value]) => {
        const entry = typeof value === "string" ? value : value.import ?? value.default;
        if (typeof entry !== "string") return [];
        const specifier = key === "." ? "@mdbase-dev/sdk" : `@mdbase-dev/sdk${key.slice(1)}`;
        return [{ find: new RegExp(`^${escape(specifier)}$`, "u"), replacement: resolve(sdkRoot, entry) }];
      }),
      offlineShellUrl: pathToFileURL(join(sdkRoot, "dist/offline-shell-build.js")).href,
      connectOrigin: release.cpOrigin,
    };
  }
  throw new Error(
    `No installed SDK is packaged for ${target} (${expectedConnect}); found ${seen.join("; ") || "none"}. Refusing to build ${target} Writer against another environment.`,
  );
}

