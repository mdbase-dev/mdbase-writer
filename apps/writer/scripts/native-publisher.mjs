// Protected native publisher guards, SDK-trust intake and receipts for
// Writer. Used by the isolated native path in deploy-writer.yml; testable
// without GitHub (native-publisher.test.mjs).
//
// Native staging/production publish straight from the authorized native
// release refs, never from main and never from an arbitrary ref. The SDK
// input must be the target environment's authenticated archive set,
// described by vendor/native-sdk-trust.<target>.json committed on that
// release ref. Until such a descriptor (and its archives) exist, every
// native publish refuses here, before build/upload. A LAB archive is
// never retargeted.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { writerDeployments } from "./deployment-environment.mjs";

export const nativeReleaseRefs = Object.freeze({
  staging: "release/native-staging",
  production: "release/native-production",
});

// Pinned package -> trust-descriptor archive key.
const pinnedArchives = Object.freeze({
  "@mdbase-dev/sdk": "sdk",
  "@mdbase-dev/ui": "ui",
  "@mdbase-dev/connect-protocol": "protocol",
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

const sha256Hex = (bytes) => createHash("sha256").update(bytes).digest("hex");

function repoRelative(repoRoot, fromDir, spec) {
  const absolute = resolve(fromDir, spec.replace(/^file:/u, ""));
  const rel = relative(repoRoot, absolute).split(sep).join(posix.sep);
  if (rel.startsWith("..")) throw new Error(`Refusing path outside the repository: ${spec}`);
  return rel;
}

export function assertDispatch({ target, sha, eventName, ref, workflowSha }) {
  const releaseRef = authorizedReleaseRef(target);
  assertFullSha(sha);
  if (eventName !== "workflow_dispatch" || ref !== `refs/heads/${releaseRef}` || workflowSha !== sha) {
    throw new Error("Refusing: native dispatch must use the literal target release branch and its exact requested source SHA.");
  }
}

function archiveMember(archive, member) {
  // Never extract or execute archive code. Only accept one regular member.
  const listing = execFileSync("tar", ["-tvzf", archive, member], { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim().split("\n");
  if (listing.length !== 1 || !listing[0].startsWith("-")) throw new Error(`Refusing unsafe/duplicate SDK member ${member}`);
  return execFileSync("tar", ["-xOzf", archive, member], { maxBuffer: 40 * 1024 * 1024 });
}

export async function loadSdkTrust({ target, repoRoot, protectedDescriptorSha256 }) {
  authorizedReleaseRef(target);
  const deployment = writerDeployments[target];
  const appRoot = join(repoRoot, "apps", "writer");
  const descriptorPath = join(appRoot, "vendor", `native-sdk-trust.${target}.json`);
  let descriptorBytes;
  try {
    if (!(await lstat(descriptorPath)).isFile() || await realpath(descriptorPath) !== descriptorPath) throw new Error("Non-regular trust descriptor");
    descriptorBytes = await readFile(descriptorPath);
  } catch {
    throw new Error(`Refusing: no authenticated ${target} SDK trust descriptor at apps/writer/vendor/native-sdk-trust.${target}.json. The target SDK archive does not exist yet; never retarget the LAB archive.`);
  }
  const refuse = (reason) => {
    throw new Error(`Refusing: ${target} SDK trust mismatch - ${reason}`);
  };
  if (!/^[0-9a-f]{64}$/u.test(protectedDescriptorSha256 ?? "")) refuse("protected environment descriptor digest WRITER_NATIVE_TRUST_SHA256 is missing");
  if (sha256Hex(descriptorBytes) !== protectedDescriptorSha256) refuse("protected descriptor digest does not match");
  const descriptor = JSON.parse(descriptorBytes);
  if (descriptor.trustEnvironment !== target) refuse("trustEnvironment must equal the target");
  if (descriptor.environment !== target) refuse(`descriptor environment "${descriptor.environment}" is not "${target}"`);
  if (descriptor.appOrigin !== deployment.origin) refuse(`app origin "${descriptor.appOrigin}" is not the exact ${target} origin ${deployment.origin}`);
  if (descriptor.connectOrigin !== deployment.connectUrl) refuse(`Connect/CP origin "${descriptor.connectOrigin}" is not the exact ${target} origin ${deployment.connectUrl}`);
  const editorOrigin = target === "staging" ? "https://editor-staging.mdbase.dev" : "https://editor.mdbase.dev";
  if (descriptor.editorOrigin !== editorOrigin) refuse(`Editor must be exactly ${editorOrigin}`);
  const packageJson = JSON.parse(await readFile(join(appRoot, "package.json"), "utf8"));
  const archives = {};
  for (const [packageName, key] of Object.entries(pinnedArchives)) {
    const archive = descriptor.archives?.[key];
    if (!archive?.path || !/^[0-9a-f]{64}$/u.test(archive.sha256 ?? "")) refuse(`archive "${key}" needs a repo-relative path and a lowercase sha256`);
    const declared = repoRelative(repoRoot, repoRoot, archive.path);
    if (declared !== archive.path) refuse("archive path must be canonical and repo-relative");
    const pinned = packageJson.dependencies?.[packageName];
    if (typeof pinned !== "string" || !pinned.startsWith("file:")) refuse(`${packageName} is not a file: pin; pin mismatch against the trusted ${key} archive`);
    if (repoRelative(repoRoot, appRoot, pinned) !== declared) refuse(`${packageName} pin "${pinned}" does not match the trusted ${key} archive "${archive.path}"`);
    let bytes;
    try {
      const archivePath = join(repoRoot, declared);
      if (!(await lstat(archivePath)).isFile() || repoRelative(await realpath(repoRoot), await realpath(repoRoot), await realpath(archivePath)) !== declared) refuse("archive symlinks are forbidden");
      bytes = await readFile(archivePath);
    } catch {
      refuse(`trusted ${key} archive "${archive.path}" is missing from the checkout`);
    }
    if (sha256Hex(bytes) !== archive.sha256) refuse(`trusted ${key} archive "${archive.path}" hash mismatch`);
    archives[key] = { path: declared, sha256: archive.sha256, bytes: bytes.byteLength };
  }
  // The protected digest is an independent approval of the canonical producer's
  // authenticated originals, NOT a self-asserted descriptor or a new trust root.
  const sdkPath = join(repoRoot, archives.sdk.path);
  const trustModule = archiveMember(sdkPath, "package/dist/application/packaged-trust.js");
  const match = /const metadata = (\{[^\n]+\});/u.exec(trustModule.toString("utf8"));
  if (!match) refuse("SDK has no canonical BUILD-verifier metadata");
  const release = JSON.parse(match[1]);
  if (release.schema !== "mdbn-app-trust/release/1" || release.environment !== target || release.cpOrigin !== deployment.connectUrl) refuse("embedded SDK trust environment/CP binding differs");
  if (!/^[0-9a-f]{64}$/u.test(release.assetSha256 ?? "") || release.source?.repository !== "mdbase-dev/mdbase-connect" || !/^[0-9a-f]{40}$/u.test(release.source?.commit ?? "")) refuse("embedded release identity is missing");
  const log = new URL(release.logOrigin);
  if (log.origin !== release.logOrigin || log.protocol !== "https:" || log.username || log.password) refuse("embedded log binding must be an exact HTTPS origin");
  const nativeAssets = {};
  for (const name of ["runtime.wasm", "sqlite3.wasm", "sqlite3.js"]) {
    const bytes = archiveMember(sdkPath, `package/dist/native/${name}`);
    nativeAssets[name] = { sha256: sha256Hex(bytes), bytes: bytes.length };
  }
  return {
    environment: target,
    trustEnvironment: descriptor.trustEnvironment,
    release,
    trustModuleSha256: sha256Hex(trustModule),
    nativeAssets,
    appOrigin: descriptor.appOrigin,
    connectOrigin: descriptor.connectOrigin,
    editorOrigin: descriptor.editorOrigin,
    descriptor: `apps/writer/vendor/native-sdk-trust.${target}.json`,
    descriptorSha256: sha256Hex(descriptorBytes),
    archives,
  };
}

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

async function walk(dir, base, out) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await walk(path, base, out);
    else if (entry.isFile()) {
      const rel = relative(base, path).split(sep).join(posix.sep);
      const bytes = await readFile(path);
      out.push({ path: rel, bytes: bytes.byteLength, sha256: sha256Hex(bytes), category: classifyAsset(rel) });
    } else throw new Error(`Refusing non-regular built asset: ${path}`);
  }
}

export async function buildAssetInventory(distDir) {
  const out = [];
  await walk(distDir, distDir, out);
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
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
  const present = new Set(inventory.map((asset) => asset.category));
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
  const response = await fetchImpl(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/mdbase-writer/deployments?per_page=100`, {
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
    status: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(deploymentId ?? "") && verification?.ok === true ? "verified" : "failed-or-incomplete",
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
      const sdkTrust = await loadSdkTrust({ target, repoRoot, protectedDescriptorSha256: process.env.WRITER_NATIVE_TRUST_SHA256 });
      const deployment = writerDeployments[target];
      console.log(JSON.stringify({ ...onRef, tree: checkout.tree, origin: deployment.origin, connectOrigin: deployment.connectUrl, pagesBranch: deployment.branch, sdkTrust }, null, 2));
    } else if (command === "inventory") {
      const inventory = await buildAssetInventory(resolve(args.dist));
      const plan = JSON.parse(await readFile(resolve(args.plan), "utf8"));
      const dist = resolve(args.dist);
      assertBuiltTarget({ target: plan.sdkTrust.environment, manifest: JSON.parse(await readFile(join(dist, ".well-known/mdbase-app.json"), "utf8")), routes: JSON.parse(await readFile(join(dist, "_routes.json"), "utf8")) });
      assertInventoryCoverage(inventory, plan.sdkTrust);
      console.log(JSON.stringify(inventory, null, 2));
    } else if (command === "capture-deployment") {
      const deployment = await captureDeployment({ output: await readFile(resolve(args["wrangler-output"]), "utf8"), target: args.target, sha: args.sha, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, apiToken: process.env.CLOUDFLARE_API_TOKEN });
      console.log(JSON.stringify(deployment, null, 2));
    } else if (command === "receipt") {
      const plan = JSON.parse(await readFile(resolve(args.plan), "utf8"));
      const inventory = JSON.parse(await readFile(resolve(args.inventory), "utf8"));
      const optionalJson = async (path) => {
        try { return JSON.parse(await readFile(resolve(path), "utf8")); }
        catch { return null; }
      };
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
