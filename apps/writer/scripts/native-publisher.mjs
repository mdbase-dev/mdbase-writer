// Source-reviewed native publisher; OFF-CI authentication is not repeated here.
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inventoryDirectory, assertInventory } from "../../../scripts/lib/native-publish-bytes.mjs";
import { loadOriginals, protectedHashes } from "../../../scripts/lib/native-originals.mjs";
import { fileURLToPath } from "node:url";

import { writerDeployments } from "./deployment-environment.mjs";

export const nativeReleaseRefs = Object.freeze({
  staging: "release/native-staging",
  production: "release/native-production",
});

export function authorizedReleaseRef(target) {
  const ref = Object.hasOwn(nativeReleaseRefs, target) ? nativeReleaseRefs[target] : undefined;
  if (!ref) throw new Error(`Target "${target}" has no authorized native release ref; refusing.`);
  return ref;
}

export function assertFullSha(sha) {
  if (!/^[0-9a-f]{40}$/u.test(sha ?? "")) {
    throw new Error("Native publish requires an exact full 40-hex source SHA; refusing anything else.");
  }
  return sha;
}

function git(cwd, args, { allowFailure = false } = {}) {
  try {
    return { ok: true, stdout: execFileSync("git", args, { cwd, encoding: "utf8" }).trim() };
  } catch (error) {
    if (allowFailure) return { ok: false, stdout: "" };
    throw error;
  }
}

function resolveReleaseRef(cwd, releaseRef) {
  for (const candidate of [`refs/remotes/origin/${releaseRef}`, `refs/heads/${releaseRef}`]) {
    if (git(cwd, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`], { allowFailure: true }).ok) return candidate;
  }
  throw new Error(`Authorized release ref ${releaseRef} is not fetched in this checkout; refusing.`);
}

export function assertShaOnReleaseRef({ target, sha, cwd }) {
  const releaseRef = authorizedReleaseRef(target);
  assertFullSha(sha);
  if (!git(cwd, ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`], { allowFailure: true }).ok) {
    throw new Error(`Source ${sha} is not a commit in this checkout; refusing.`);
  }
  const resolved = resolveReleaseRef(cwd, releaseRef);
  const releaseTip = git(cwd, ["rev-parse", `${resolved}^{commit}`]).stdout;
  if (sha !== releaseTip) {
    throw new Error(`Source ${sha} is not on ${releaseRef} at its exact publication head ${releaseTip}; refusing.`);
  }
  return { sha, releaseRef, releaseTip };
}

export function assertExactCleanCheckout({ sha, cwd }) {
  assertFullSha(sha);
  const head = git(cwd, ["rev-parse", "HEAD"]).stdout;
  if (head !== sha) throw new Error(`Checkout HEAD ${head} does not equal the requested source SHA ${sha}; refusing.`);
  const status = git(cwd, ["status", "--porcelain", "--untracked-files=all"]).stdout;
  if (status !== "") throw new Error(`Native publish requires a clean checkout; refusing with uncommitted paths: ${status.split("\n").slice(0, 5).join(", ")}`);
  return { sha, tree: git(cwd, ["rev-parse", "HEAD^{tree}"]).stdout };
}

export function assertDispatch({ target, sha, eventName, ref, workflowSha }) {
  const releaseRef = authorizedReleaseRef(target);
  assertFullSha(sha);
  if (eventName !== "workflow_dispatch" || ref !== `refs/heads/${releaseRef}` || workflowSha !== sha) {
    throw new Error("Refusing: native dispatch must use the literal target release branch and its exact requested source SHA.");
  }
}

export const loadSdkTrust = loadOriginals;

export function classifyAsset(path) {
  if (path === ".well-known/mdbase-app.json") return "manifest";
  if (path.startsWith(".well-known/") || /trust/iu.test(path)) return "trust";
  if (/\.html?$/iu.test(path)) return "html";
  if (/\.wasm$/iu.test(path)) return "wasm";
  if (/\.(sqlite3?|db)$/iu.test(path)) return "sqlite";
  if (/\.(m?js|cjs)$/iu.test(path)) return "js";
  return "other";
}

export const requiredAssetCategories = Object.freeze(["html", "manifest", "js", "wasm"]);

export async function buildAssetInventory(distDir) {
  return (await inventoryDirectory(distDir, { maxFileBytes: 25 * 1024 * 1024 })).map(asset => ({ ...asset, category: classifyAsset(asset.path) }));
}

export function assertInventoryCoverage(inventory, sdkTrust) {
  for (const asset of inventory) {
    if (!asset.path || asset.path.split("/").some((part) => !part || part === "." || part === "..") || !/^[0-9a-f]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) throw new Error("Invalid asset inventory; refusing.");
    if (asset.bytes > 25 * 1024 * 1024) throw new Error(`Asset ${asset.path} exceeds Pages' 25 MiB limit`);
  }
  if (new Set(inventory.map((a) => a.path)).size !== inventory.length) throw new Error("Duplicate inventory paths; refusing");
  for (const [name, pin] of Object.entries(sdkTrust?.nativeAssets ?? {})) {
    if (!inventory.some((asset) => asset.sha256 === pin.sha256 && asset.bytes === pin.bytes)) throw new Error(`Missing exact SDK native/SQLite bytes for ${name}; refusing`);
  }
  if (sdkTrust && !inventory.some(asset => asset.path === "_worker.js" || asset.path === "_worker.js/index.js")) throw new Error("Missing precompiled Pages Worker; refusing");
  const present = new Set(inventory.map((asset) => classifyAsset(asset.path)));
  const missing = requiredAssetCategories.filter((category) => !present.has(category));
  if (missing.length > 0) throw new Error(`Built assets are missing required categories: ${missing.join(", ")}; refusing to upload.`);
}

export function assertBuiltTarget({ target, manifest, routes }) {
  authorizedReleaseRef(target);
  const origin = writerDeployments[target].origin;
  if (manifest.homepage !== `${origin}/` || manifest.redirect_uris?.length !== 1 || manifest.redirect_uris[0] !== `${origin}/` || !manifest.installation_origins?.[target]?.["app-runtime"]?.includes(origin)) throw new Error("Refusing: built manifest is not bound to the exact target");
  if (routes.version !== 1 || routes.include?.length !== 1 || routes.include[0] !== "/wasm/*" || routes.exclude?.length !== 0) throw new Error("Refusing: Pages Functions must remain limited to /wasm/*");
}

// This is only the URL prefix; captureDeployment resolves the actual API UUID.
export function parseDeploymentId(output) {
  const match = /https:\/\/([0-9a-f]{8,32})\.mdbase-writer\.pages\.dev\b/iu.exec(output ?? "");
  return match ? match[1].toLowerCase() : null;
}

export async function captureDeployment({ output, target, sha, accountId, apiToken, fetchImpl = fetch }) {
  const prefix = parseDeploymentId(output);
  if (!prefix || !accountId || !apiToken) throw new Error("Refusing: missing unique deployment URL or Cloudflare credentials");
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/mdbase-writer/deployments?per_page=20`, {
    headers: { Authorization: `Bearer ${apiToken}` }, redirect: "error", signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Deployment ID lookup failed: HTTP ${response.status}`);
  const body = await response.json();
  const url = `https://${prefix}.mdbase-writer.pages.dev`;
  const branch = writerDeployments[target]?.branch;
  const matches = body.success && Array.isArray(body.result) ? body.result.filter((d) => d.url === url && d.deployment_trigger?.metadata?.commit_hash === sha && d.deployment_trigger?.metadata?.branch === branch) : [];
  if (matches.length !== 1 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(matches[0].id ?? "")) throw new Error("No unambiguous deployment ID bound to uploaded URL/source/channel");
  return { id: matches[0].id, url, sourceSha: sha, pagesBranch: branch };
}

function publicationEvidenceComplete(inventory, verification, deploymentId, sourceSha) {
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(deploymentId ?? "") || verification?.ok !== true || inventory.length === 0 || verification.failures?.length !== 0 || verification.unverified?.length !== 0 || verification.policyFailures?.length !== 0) return false;
  const policy = verification.policyEvidence;
  if (policy?.metadata?.deployment?.id !== deploymentId || policy.metadata.deployment.sourceSha !== sourceSha || policy.behavior?.length !== 4 || verification.runtimeVerified?.length !== 2 || !/^[0-9a-f]{64}$/.test(policy.sourceConfigSha256 ?? "")) return false;
  const covered = policy.coveredControls ?? [];
  if (!covered.some(a => a.path === "_routes.json") || !covered.some(a => a.path === "_worker.js" || a.path === "_worker.js/index.js") || covered.some(a => a.path !== "_routes.json" && a.path !== "_worker.js" && !a.path.startsWith("_worker.js/"))) return false;
  const seen = [...(verification.verified ?? []), ...covered];
  return seen.length === inventory.length && new Set(seen.map(a => a.path)).size === seen.length && inventory.every(asset => seen.some(item => item.path === asset.path && item.sha256 === asset.sha256 && item.bytes === asset.bytes));
}

export function createReceipt({ target, source, releaseRef, sdkTrust, inventory, deploymentId = null, deployment = null, verification = null }) {
  authorizedReleaseRef(target);
  return {
    schema: "mdbase-writer/native-publisher-receipt@1",
    target,
    releaseRef,
    source: { sha: source.sha, tree: source.tree },
    sdkTrust,
    pagesProject: "mdbase-writer",
    origin: writerDeployments[target].origin,
    deploymentId,
    deployment,
    assets: inventory,
    verification,
    run: { repository: process.env.GITHUB_REPOSITORY ?? null, id: process.env.GITHUB_RUN_ID ?? null, attempt: process.env.GITHUB_RUN_ATTEMPT ?? null },
    status: publicationEvidenceComplete(inventory, verification, deploymentId, source.sha) ? "verified" : "failed-or-incomplete",
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index].startsWith("--")) args[argv[index].slice(2)] = argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[(index += 1)] : "true";
  }
  return args;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  try {
    if (command === "guard") {
      const repoRoot = resolve(args["repo-root"] ?? ".");
      const target = args.target;
      assertDispatch({ target, sha: args.sha, eventName: process.env.GITHUB_EVENT_NAME, ref: process.env.GITHUB_REF, workflowSha: process.env.GITHUB_SHA });
      const onRef = assertShaOnReleaseRef({ target, sha: args.sha, cwd: repoRoot });
      const checkout = assertExactCleanCheckout({ sha: args.sha, cwd: repoRoot });
      const sdkTrust = await loadSdkTrust({ target, repoRoot, hashes: protectedHashes(), installed: args.installed === "true" });
      const deployment = writerDeployments[target];
      console.log(JSON.stringify({ ...onRef, tree: checkout.tree, origin: deployment.origin, connectOrigin: deployment.connectUrl, pagesBranch: deployment.branch, sdkTrust }, null, 2));
    } else if (command === "inventory") {
      const inventory = await buildAssetInventory(resolve(args.dist));
      const plan = JSON.parse(await readFile(resolve(args.plan), "utf8"));
      const dist = resolve(args.dist);
      assertBuiltTarget({ target: plan.sdkTrust.environment, manifest: JSON.parse(await readFile(join(dist, ".well-known/mdbase-app.json"), "utf8")), routes: JSON.parse(await readFile(join(dist, "_routes.json"), "utf8")) });
      assertInventoryCoverage(inventory, plan.sdkTrust);
      console.log(JSON.stringify(inventory, null, 2));
    } else if (command === "assert-inventory") {
      await assertInventory(args.dist, JSON.parse(await readFile(args.inventory, "utf8")));
    } else if (command === "capture-deployment") {
      const deployment = await captureDeployment({ output: await readFile(resolve(args["wrangler-output"]), "utf8"), target: args.target, sha: args.sha, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, apiToken: process.env.CLOUDFLARE_API_TOKEN });
      console.log(JSON.stringify(deployment, null, 2));
    } else if (command === "receipt") {
      const optionalJson = async (path) => {
        try { return JSON.parse(await readFile(resolve(path), "utf8")); }
        catch { return null; }
      };
      const plan = await optionalJson(args.plan) ?? { sha: process.env.SOURCE_SHA, tree: git(resolve("."), ["rev-parse", "HEAD^{tree}"]).stdout, releaseRef: authorizedReleaseRef(args.target), sdkTrust: null };
      const inventory = await optionalJson(args.inventory) ?? [];
      const verification = await optionalJson(args.verification) ?? { ok: false, error: "Verification unavailable/not attempted" };
      const deployment = await optionalJson(args.deployment);
      const deploymentId = deployment?.sourceSha === plan.sha && deployment?.pagesBranch === plan.pagesBranch ? deployment.id : null;
      const receipt = createReceipt({ target: args.target, source: { sha: plan.sha, tree: plan.tree }, releaseRef: plan.releaseRef, sdkTrust: plan.sdkTrust, inventory, deploymentId, deployment, verification });
      console.log(JSON.stringify(receipt, null, 2));
      if (receipt.status !== "verified") process.exitCode = 1;
    } else {
      console.error("Usage: native-publisher.mjs guard --target <staging|production> --sha <full-sha> --repo-root <path> | inventory --dist <path> --plan <f> | capture-deployment --target <t> --sha <sha> --wrangler-output <f> | receipt --target <t> --plan <f> --inventory <f> --verification <f> --deployment <f>");
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
