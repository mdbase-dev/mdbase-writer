import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  assertBuiltTarget,
  assertDispatch,
  assertExactCleanCheckout,
  assertFullSha,
  assertInventoryCoverage,
  assertShaOnReleaseRef,
  authorizedReleaseRef,
  buildAssetInventory,
  classifyAsset,
  captureDeployment,
  createReceipt,
  loadSdkTrust,
  parseDeploymentId,
} from "./native-publisher.mjs";
import { isFetchableAsset, servedUrlFor, verifyServedAssets } from "./verify-served.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const FULL_SHA = "a".repeat(40);

test("manual dispatch is bound to literal target ref and exact workflow/source SHA", () => {
  const valid = { target: "staging", sha: FULL_SHA, eventName: "workflow_dispatch", ref: "refs/heads/release/native-staging", workflowSha: FULL_SHA };
  assert.doesNotThrow(() => assertDispatch(valid));
  assert.doesNotThrow(() => assertDispatch({ ...valid, target: "production", ref: "refs/heads/release/native-production" }));
  for (const override of [{ eventName: "push" }, { eventName: "pull_request" }, { ref: "refs/heads/main" }, { ref: "refs/heads/release/native-production" }, { workflowSha: "b".repeat(40) }, { sha: "main" }]) assert.throws(() => assertDispatch({ ...valid, ...override }));
});

test("only staging and production have authorized native release refs", () => {
  assert.equal(authorizedReleaseRef("staging"), "release/native-staging");
  assert.equal(authorizedReleaseRef("production"), "release/native-production");
  assert.throws(() => authorizedReleaseRef("lab"), /no authorized native release ref/u);
  assert.throws(() => authorizedReleaseRef("main"), /no authorized native release ref/u);
  assert.throws(() => authorizedReleaseRef(""), /no authorized native release ref/u);
});

test("prototype names are not release targets", () => {
  assert.throws(() => authorizedReleaseRef("toString"), /no authorized/u);
});

test("trust descriptor needs an independently approved protected digest", async () => {
  const { repo } = await trustFixture("staging");
  try {
    await assert.rejects(loadSdkTrust({ target: "staging", repoRoot: repo }), /protected.*digest/iu);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test("trust environment and exact Editor destination cannot be overridden", async () => {
  for (const overrides of [{ trustEnvironment: "lab" }, { editorOrigin: "https://evil.example" }]) {
    const { repo } = await trustFixture("staging", overrides);
    try {
      await assert.rejects(approvedTrust({ target: "staging", repoRoot: repo }), /refusing/iu);
    } finally { await rm(repo, { recursive: true, force: true }); }
  }
});

test("verifier refuses empty inventories and zero attempts", async () => {
  await assert.rejects(verifyServedAssets({ origin: "https://staging.mdbase-writer.pages.dev", inventory: [] }), /inventory|categories/iu);
  const dist = await distFixture(DIST_FILES);
  try {
    const inventory = await buildAssetInventory(dist);
    await assert.rejects(verifyServedAssets({ origin: "https://staging.mdbase-writer.pages.dev", inventory, attempts: 0 }), /bound|attempt/iu);
  } finally { await rm(dist, { recursive: true, force: true }); }
});

test("body read failures produce a failed receipt instead of throwing", async () => {
  const dist = await distFixture(DIST_FILES);
  try {
    const inventory = await buildAssetInventory(dist);
    const result = await verifyServedAssets({ origin: "https://staging.mdbase-writer.pages.dev", inventory, attempts: 1,
      fetchImpl: async (url) => ({ ok: true, status: 200, url, arrayBuffer: async () => { throw new Error("body interrupted"); } }) });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /body interrupted/u);
  } finally { await rm(dist, { recursive: true, force: true }); }
});

test("source SHA must be an exact full 40-hex SHA", () => {
  assert.equal(assertFullSha(FULL_SHA), FULL_SHA);
  assert.throws(() => assertFullSha("a".repeat(39)), /full 40-hex/u);
  assert.throws(() => assertFullSha("A".repeat(40)), /full 40-hex/u);
  assert.throws(() => assertFullSha("release/native-staging"), /full 40-hex/u);
  assert.throws(() => assertFullSha(""), /full 40-hex/u);
});

function gitFixture() {
  return mkdtemp(join(tmpdir(), "writer-native-publisher-"));
}

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("SHA must be contained in the authorized release ref for its target", async () => {
  const repo = await gitFixture();
  try {
    git(repo, "init", "-b", "release/native-staging");
    git(repo, "config", "user.email", "test@example.invalid");
    git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "a.txt"), "a\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-m", "base");
    const base = git(repo, "rev-parse", "HEAD");
    await writeFile(join(repo, "a.txt"), "ab\n");
    git(repo, "commit", "-am", "tip");
    const tip = git(repo, "rev-parse", "HEAD");
    git(repo, "switch", "--orphan", "side");
    git(repo, "commit", "--allow-empty", "-m", "orphan");
    const orphan = git(repo, "rev-parse", "HEAD");
    git(repo, "switch", "release/native-staging");

    assert.equal(assertShaOnReleaseRef({ target: "staging", sha: tip, cwd: repo }).releaseTip, tip);
    assert.throws(() => assertShaOnReleaseRef({ target: "staging", sha: base, cwd: repo }), /exact publication head/u);
    assert.throws(() => assertShaOnReleaseRef({ target: "staging", sha: orphan, cwd: repo }), /not on release\/native-staging/u);
    assert.throws(() => assertShaOnReleaseRef({ target: "production", sha: tip, cwd: repo }), /release\/native-production/u);
    assert.throws(() => assertShaOnReleaseRef({ target: "staging", sha: "b".repeat(40), cwd: repo }), /not a commit/u);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("checkout must be exactly the requested SHA with a clean tree", async () => {
  const repo = await gitFixture();
  try {
    git(repo, "init", "-b", "release/native-staging");
    git(repo, "config", "user.email", "test@example.invalid");
    git(repo, "config", "user.name", "Test");
    await writeFile(join(repo, "a.txt"), "a\n");
    git(repo, "add", "a.txt");
    git(repo, "commit", "-m", "base");
    const head = git(repo, "rev-parse", "HEAD");
    const tree = git(repo, "rev-parse", "HEAD^{tree}");
    assert.deepEqual(assertExactCleanCheckout({ sha: head, cwd: repo }), { sha: head, tree });
    assert.throws(() => assertExactCleanCheckout({ sha: "c".repeat(40), cwd: repo }), /does not equal/u);
    await writeFile(join(repo, "a.txt"), "dirty\n");
    assert.throws(() => assertExactCleanCheckout({ sha: head, cwd: repo }), /clean/u);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

async function trustFixture(environment, overrides = {}) {
  const repo = await gitFixture();
  const app = join(repo, "apps", "writer");
  await mkdir(join(app, "vendor"), { recursive: true });
  await mkdir(join(repo, "vendor"), { recursive: true });
  const native = join(repo, "sdk-source", "package", "dist", "native");
  await mkdir(native, { recursive: true });
  for (const name of ["runtime.wasm", "sqlite3.wasm", "sqlite3.js"]) await writeFile(join(native, name), name);
  const metadata = { schema: "mdbn-app-trust/release/1", environment,
    cpOrigin: environment === "staging" ? "https://connect-staging.mdbase.dev" : "https://connect.mdbase.dev",
    logOrigin: "https://producer-log.example", assetSha256: "d".repeat(64),
    source: { repository: "mdbase-dev/mdbase-connect", commit: "a".repeat(40), version: "test" } };
  await mkdir(join(native, "..", "application"), { recursive: true });
  await writeFile(join(native, "..", "application", "packaged-trust.js"), `const metadata = ${JSON.stringify(metadata)};\n`);
  execFileSync("tar", ["-czf", join(repo, "vendor", "sdk.tgz"), "-C", join(repo, "sdk-source"), "package"]);
  const sdkBytes = await readFile(join(repo, "vendor", "sdk.tgz"));
  const uiBytes = Buffer.from("ui-archive");
  const protocolBytes = Buffer.from("protocol-archive");
  await writeFile(join(repo, "vendor", "sdk.tgz"), sdkBytes);
  await writeFile(join(repo, "vendor", "ui.tgz"), uiBytes);
  await writeFile(join(app, "vendor", "protocol.tgz"), protocolBytes);
  await writeFile(
    join(app, "package.json"),
    JSON.stringify({
      dependencies: {
        "@mdbase-dev/sdk": "file:../../vendor/sdk.tgz",
        "@mdbase-dev/ui": "file:../../vendor/ui.tgz",
        "@mdbase-dev/connect-protocol": "file:vendor/protocol.tgz",
      },
    }),
  );
  const staging = environment === "staging";
  const descriptor = {
    environment,
    trustEnvironment: environment,
    appOrigin: staging ? "https://staging.mdbase-writer.pages.dev" : "https://writer.mdbase.dev",
    connectOrigin: staging ? "https://connect-staging.mdbase.dev" : "https://connect.mdbase.dev",
    editorOrigin: staging ? "https://editor-staging.mdbase.dev" : "https://editor.mdbase.dev",
    archives: {
      sdk: { path: "vendor/sdk.tgz", sha256: sha256(sdkBytes) },
      ui: { path: "vendor/ui.tgz", sha256: sha256(uiBytes) },
      protocol: { path: "apps/writer/vendor/protocol.tgz", sha256: sha256(protocolBytes) },
    },
    ...overrides,
  };
  await writeFile(join(app, "vendor", `native-sdk-trust.${environment}.json`), JSON.stringify(descriptor));
  return { repo, app };
}

async function approvedTrust({ target, repoRoot }) {
  const descriptor = await readFile(join(repoRoot, "apps/writer/vendor", `native-sdk-trust.${target}.json`));
  return loadSdkTrust({ target, repoRoot, protectedDescriptorSha256: sha256(descriptor) });
}

test("missing target SDK trust refuses before upload", async () => {
  const repo = await gitFixture();
  try {
    await assert.rejects(loadSdkTrust({ target: "staging", repoRoot: repo }), /refusing.*no authenticated staging SDK trust/iu);
    await assert.rejects(loadSdkTrust({ target: "lab", repoRoot: repo }), /no authorized native release ref/u);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("target SDK trust verifies environment, origins, archive hashes and pins", async () => {
  const { repo } = await trustFixture("staging");
  try {
    const trust = await approvedTrust({ target: "staging", repoRoot: repo });
    assert.equal(trust.environment, "staging");
    assert.equal(trust.connectOrigin, "https://connect-staging.mdbase.dev");
    assert.equal(trust.archives.sdk.sha256, sha256(await readFile(join(repo, "vendor/sdk.tgz"))));
    assert.equal(trust.release.environment, "staging");
    assert.equal(trust.nativeAssets["runtime.wasm"].sha256, sha256("runtime.wasm"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("guard CLI produces an exact clean authenticated target plan without GitHub", async () => {
  const { repo, app } = await trustFixture("staging");
  try {
    git(repo, "init", "-b", "release/native-staging");
    git(repo, "config", "user.email", "test@example.invalid");
    git(repo, "config", "user.name", "Test");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "qualified fixture originals");
    const sha = git(repo, "rev-parse", "HEAD");
    const plan = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL("./native-publisher.mjs", import.meta.url)), "guard", "--target", "staging", "--sha", sha, "--repo-root", repo], {
      encoding: "utf8", env: { ...process.env, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/release/native-staging", GITHUB_SHA: sha,
        WRITER_NATIVE_TRUST_SHA256: sha256(await readFile(join(app, "vendor/native-sdk-trust.staging.json"))) },
    }));
    assert.equal(plan.sha, sha);
    assert.equal(plan.tree, git(repo, "rev-parse", "HEAD^{tree}"));
    assert.equal(plan.pagesBranch, "staging");
    assert.equal(plan.sdkTrust.release.cpOrigin, "https://connect-staging.mdbase.dev");
    assert.equal(plan.loopbackUrl, undefined);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test("production selects its own SDK trust and exact Editor/CP origins", async () => {
  const { repo } = await trustFixture("production");
  try {
    const trust = await approvedTrust({ target: "production", repoRoot: repo });
    assert.equal(trust.editorOrigin, "https://editor.mdbase.dev");
    assert.equal(trust.release.cpOrigin, "https://connect.mdbase.dev");
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test("unapproved descriptor digest refuses even if its self-declared hashes match", async () => {
  const { repo } = await trustFixture("staging");
  try {
    await assert.rejects(loadSdkTrust({ target: "staging", repoRoot: repo, protectedDescriptorSha256: "0".repeat(64) }), /protected descriptor digest/u);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test("LAB SDK cannot be relabeled by editing and approving a target descriptor", async () => {
  const { repo, app } = await trustFixture("staging");
  try {
    const module = join(repo, "sdk-source/package/dist/application/packaged-trust.js");
    await writeFile(module, (await readFile(module, "utf8")).replace('"environment":"staging"', '"environment":"lab"'));
    execFileSync("tar", ["-czf", join(repo, "vendor/sdk.tgz"), "-C", join(repo, "sdk-source"), "package"]);
    const path = join(app, "vendor/native-sdk-trust.staging.json");
    const descriptor = JSON.parse(await readFile(path, "utf8"));
    descriptor.archives.sdk.sha256 = sha256(await readFile(join(repo, "vendor/sdk.tgz")));
    await writeFile(path, JSON.stringify(descriptor));
    await assert.rejects(approvedTrust({ target: "staging", repoRoot: repo }), /embedded SDK trust environment\/CP/u);
  } finally { await rm(repo, { recursive: true, force: true }); }
});

test("LAB or mismatched SDK trust is refused, never retargeted", async () => {
  for (const overrides of [
    { environment: "lab" },
    { connectOrigin: "https://connect-lab.mdbase.dev" },
    { appOrigin: "https://lab.mdbase-writer.pages.dev" },
    { editorOrigin: "http://127.0.0.1:1234" },
    { archives: { sdk: { path: "vendor/sdk.tgz", sha256: "0".repeat(64) }, ui: { path: "vendor/ui.tgz", sha256: sha256(Buffer.from("ui-archive")) }, protocol: { path: "apps/writer/vendor/protocol.tgz", sha256: sha256(Buffer.from("protocol-archive")) } } },
  ]) {
    const { repo } = await trustFixture("staging", overrides);
    try {
      await assert.rejects(approvedTrust({ target: "staging", repoRoot: repo }), /refusing|mismatch|hash/iu);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  }
});

test("SDK trust refuses when package pins do not match the trusted archives", async () => {
  const { repo, app } = await trustFixture("production");
  try {
    await writeFile(
      join(app, "package.json"),
      JSON.stringify({ dependencies: { "@mdbase-dev/sdk": "file:../../vendor/other.tgz", "@mdbase-dev/ui": "file:../../vendor/ui.tgz", "@mdbase-dev/connect-protocol": "file:vendor/protocol.tgz" } }),
    );
    await assert.rejects(approvedTrust({ target: "production", repoRoot: repo }), /pin.*mismatch|does not match/iu);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

async function distFixture(files) {
  const dir = await gitFixture();
  for (const [path, bytes] of Object.entries(files)) {
    await mkdir(join(dir, path, ".."), { recursive: true });
    await writeFile(join(dir, path), bytes);
  }
  return dir;
}

const DIST_FILES = {
  "index.html": "<html>writer</html>",
  ".well-known/mdbase-app.json": "{\"id\":\"dev.mdbase.writer\"}",
  "assets/app.js": "console.log(1)",
  "assets/runtime.wasm": Buffer.from([0, 97, 115, 109]),
  "assets/db.sqlite3": Buffer.from("SQLite format 3\0"),
  "assets/sqlite3.js": "export default initialize;",
  "assets/release-trust.json": '{"environment":"staging"}',
  "_routes.json": "{\"include\":[\"/wasm/*\"]}",
};

test("inventory hashes every built asset, sorted, with categories", async () => {
  const dist = await distFixture(DIST_FILES);
  try {
    const inventory = await buildAssetInventory(dist);
    assert.deepEqual(inventory.map((a) => a.path), Object.keys(DIST_FILES).sort());
    assert.equal(inventory.find((a) => a.path === "assets/app.js").sha256, sha256("console.log(1)"));
    assert.equal(classifyAsset(".well-known/mdbase-app.json"), "manifest");
    assert.equal(classifyAsset("index.html"), "html");
    assert.equal(classifyAsset("assets/runtime.wasm"), "wasm");
    assert.equal(classifyAsset("assets/db.sqlite3"), "sqlite");
    assert.doesNotThrow(() => assertInventoryCoverage(inventory));
    assert.throws(() => assertInventoryCoverage(inventory.filter((a) => a.category !== "wasm")), /wasm/u);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test("built manifest and Functions scope must match the target exactly", () => {
  const manifest = { homepage: "https://staging.mdbase-writer.pages.dev/", redirect_uris: ["https://staging.mdbase-writer.pages.dev/"], installation_origins: { staging: { "app-runtime": ["https://staging.mdbase-writer.pages.dev"] } } };
  const routes = { version: 1, include: ["/wasm/*"], exclude: [] };
  assert.doesNotThrow(() => assertBuiltTarget({ target: "staging", manifest, routes }));
  assert.throws(() => assertBuiltTarget({ target: "production", manifest, routes }), /exact target/u);
  assert.throws(() => assertBuiltTarget({ target: "staging", manifest, routes: { ...routes, include: ["/*"] } }), /limited/u);
});

test("inventory refuses symlinks instead of silently omitting assets", async () => {
  const dist = await distFixture(DIST_FILES);
  try {
    await symlink("index.html", join(dist, "linked.html"));
    await assert.rejects(buildAssetInventory(dist), /non-regular/u);
  } finally { await rm(dist, { recursive: true, force: true }); }
});

test("receipt records source, trust, inventory and deployment id", () => {
  const receipt = createReceipt({
    target: "staging",
    source: { sha: FULL_SHA, tree: "d".repeat(40) },
    releaseRef: "release/native-staging",
    sdkTrust: { environment: "staging", connectOrigin: "https://connect-staging.mdbase.dev", archives: {} },
    inventory: [{ path: "index.html", bytes: 1, sha256: "e".repeat(64), category: "html" }],
    deploymentId: "abc123",
    verification: { ok: true },
  });
  assert.equal(receipt.source.sha, FULL_SHA);
  assert.equal(receipt.source.tree, "d".repeat(40));
  assert.equal(receipt.deploymentId, "abc123");
  assert.equal(receipt.assets.length, 1);
  assert.match(receipt.schema, /native-publisher-receipt/u);
});

test("deployment id is parsed from the Pages deployment URL", () => {
  assert.equal(parseDeploymentId("Deployment complete! https://abc123def.mdbase-writer.pages.dev/"), "abc123def");
  assert.equal(parseDeploymentId("no url here"), null);
  assert.equal(parseDeploymentId("https://staging.mdbase-writer.pages.dev"), null);
});

test("receipt cannot pass without both a deployment ID and exact served bytes", () => {
  const args = { target: "staging", source: { sha: FULL_SHA, tree: FULL_SHA }, inventory: [], sdkTrust: {}, releaseRef: "release/native-staging" };
  assert.equal(createReceipt({ ...args, verification: { ok: true } }).status, "failed-or-incomplete");
  assert.equal(createReceipt({ ...args, deploymentId: "abc", verification: { ok: false } }).status, "failed-or-incomplete");
  assert.equal(createReceipt({ ...args, deploymentId: "abc", verification: { ok: true } }).status, "failed-or-incomplete");
  assert.equal(createReceipt({ ...args, deploymentId: "12345678-1234-1234-1234-123456789abc", verification: { ok: true } }).status, "verified");
});

test("API deployment ID must match the unique URL, source and Pages channel", async () => {
  const deployment = { id: "12345678-1234-1234-1234-123456789abc", url: "https://abcdef12.mdbase-writer.pages.dev", deployment_trigger: { metadata: { commit_hash: FULL_SHA, branch: "staging" } } };
  const args = { output: deployment.url, target: "staging", sha: FULL_SHA, accountId: "fixture-account", apiToken: "fixture-not-a-secret" };
  const fetchImpl = async (_url, options) => {
    assert.equal(options.redirect, "error");
    return { ok: true, json: async () => ({ success: true, result: [deployment] }) };
  };
  assert.equal((await captureDeployment({ ...args, fetchImpl })).id, deployment.id);
  await assert.rejects(captureDeployment({ ...args, sha: "b".repeat(40), fetchImpl }), /No unambiguous/u);
  await assert.rejects(captureDeployment({ ...args, target: "production", fetchImpl }), /No unambiguous/u);
});

test("inventory requires the SDK's exact native/SQLite files, not any WASM", async () => {
  const dist = await distFixture(DIST_FILES);
  try {
    const inventory = await buildAssetInventory(dist);
    assert.throws(() => assertInventoryCoverage(inventory, { nativeAssets: { "sqlite3.js": { sha256: "f".repeat(64), bytes: 3 } } }), /Missing exact SDK/u);
    assert.throws(() => assertInventoryCoverage([...inventory, inventory[0]]), /Duplicate/u);
    assert.throws(() => assertInventoryCoverage([...inventory, { path: "../escape", sha256: "f".repeat(64), bytes: 0 }]), /Invalid/u);
  } finally { await rm(dist, { recursive: true, force: true }); }
});

test("served URLs map index documents and skip Pages-internal files", () => {
  assert.equal(servedUrlFor("https://staging.mdbase-writer.pages.dev", "index.html"), "https://staging.mdbase-writer.pages.dev/");
  assert.equal(servedUrlFor("https://staging.mdbase-writer.pages.dev", "assets/app.js"), "https://staging.mdbase-writer.pages.dev/assets/app.js");
  assert.equal(isFetchableAsset("_routes.json"), false);
  assert.equal(isFetchableAsset("_headers"), false);
  assert.equal(isFetchableAsset("index.html"), true);
  assert.equal(servedUrlFor("https://writer.mdbase.dev", "404.html"), "https://writer.mdbase.dev/404");
});

function fakeFetch(served) {
  return async (url) => {
    const path = new URL(url).pathname;
    const bytes = served[path];
    if (bytes === undefined) return { ok: false, status: 404, url, arrayBuffer: async () => new ArrayBuffer(0) };
    const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    return { ok: true, status: 200, url, arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) };
  };
}

const SERVED = {
  "/": DIST_FILES["index.html"],
  "/.well-known/mdbase-app.json": DIST_FILES[".well-known/mdbase-app.json"],
  "/assets/app.js": DIST_FILES["assets/app.js"],
  "/assets/runtime.wasm": DIST_FILES["assets/runtime.wasm"],
  "/assets/db.sqlite3": DIST_FILES["assets/db.sqlite3"],
  "/assets/sqlite3.js": DIST_FILES["assets/sqlite3.js"],
  "/assets/release-trust.json": DIST_FILES["assets/release-trust.json"],
};

test("served-byte verifier passes only on exact byte equality", async () => {
  const dist = await distFixture(DIST_FILES);
  try {
    const inventory = await buildAssetInventory(dist);
    const result = await verifyServedAssets({ origin: "https://staging.mdbase-writer.pages.dev", inventory, fetchImpl: fakeFetch(SERVED), sleepImpl: async () => {} });
    assert.equal(result.ok, true);
    assert.equal(result.checked, Object.keys(SERVED).length);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test("served-byte verifier fails the receipt on any mismatch or HTTP error", async () => {
  const dist = await distFixture(DIST_FILES);
  try {
    const inventory = await buildAssetInventory(dist);
    for (const path of Object.keys(SERVED)) {
      const wrong = { ...SERVED, [path]: "tampered" };
      const mismatch = await verifyServedAssets({ origin: "https://staging.mdbase-writer.pages.dev", inventory, fetchImpl: fakeFetch(wrong), attempts: 2, sleepImpl: async () => {} });
      assert.equal(mismatch.ok, false, path);
      assert.equal(mismatch.mismatches.length, 1, path);
    }
    const missing = { ...SERVED };
    delete missing["/assets/runtime.wasm"];
    const notFound = await verifyServedAssets({ origin: "https://staging.mdbase-writer.pages.dev", inventory, fetchImpl: fakeFetch(missing), attempts: 1, sleepImpl: async () => {} });
    assert.equal(notFound.ok, false);
    assert.match(JSON.stringify(notFound.mismatches), /runtime\.wasm/u);
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});

test("verifier rejects redirects, oversized bodies, unapproved origins and excessive retry bounds", async () => {
  const dist = await distFixture(DIST_FILES);
  try {
    const inventory = await buildAssetInventory(dist);
    for (const response of [
      { status: 302, url: "https://login.example/" },
      { status: 200, url: "https://writer.mdbase.dev/" },
    ]) {
      const result = await verifyServedAssets({ origin: "https://staging.mdbase-writer.pages.dev", inventory, attempts: 1, fetchImpl: async () => response });
      assert.equal(result.ok, false);
    }
    const result = await verifyServedAssets({ origin: "https://staging.mdbase-writer.pages.dev", inventory, attempts: 1,
      fetchImpl: async (url) => ({ status: 200, url, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4096)); controller.close(); } }) }) });
    assert.equal(result.ok, false);
    assert.match(JSON.stringify(result), /size bound/u);
    await assert.rejects(verifyServedAssets({ origin: "https://evil.example", inventory }), /non-target/u);
    await assert.rejects(verifyServedAssets({ origin: "https://writer.mdbase.dev", inventory, attempts: 13 }), /bound/u);
  } finally { await rm(dist, { recursive: true, force: true }); }
});

test("verifier global deadline fails rather than waiting through all attempts", async () => {
  const dist = await distFixture(DIST_FILES);
  try {
    const inventory = await buildAssetInventory(dist);
    const result = await verifyServedAssets({ origin: "https://writer.mdbase.dev", inventory, totalTimeoutMs: 5, attempts: 12,
      fetchImpl: async (_url, { signal }) => {
        await new Promise((done) => setTimeout(done, 10));
        signal.throwIfAborted();
      } });
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.equal(result.attemptsUsed, 1);
  } finally { await rm(dist, { recursive: true, force: true }); }
});

test("served-byte verifier is bounded and retries propagation within the bound", async () => {
  const dist = await distFixture(DIST_FILES);
  try {
    const inventory = await buildAssetInventory(dist);
    let calls = 0;
    const flaky = async (url) => {
      calls += 1;
      if (calls <= Object.keys(SERVED).length) return { ok: false, status: 503, url, arrayBuffer: async () => new ArrayBuffer(0) };
      return fakeFetch(SERVED)(url);
    };
    const result = await verifyServedAssets({ origin: "https://staging.mdbase-writer.pages.dev", inventory, fetchImpl: flaky, attempts: 3, sleepImpl: async () => {} });
    assert.equal(result.ok, true);
    assert.equal(result.attemptsUsed, 2);
    await assert.rejects(
      verifyServedAssets({ origin: "https://staging.mdbase-writer.pages.dev", inventory, fetchImpl: fakeFetch(SERVED), maxAssets: 2 }),
      /bound/u,
    );
  } finally {
    await rm(dist, { recursive: true, force: true });
  }
});
