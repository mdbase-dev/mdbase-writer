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

import { trustFixture } from "../../../tests/native-originals-fixture.mjs";
import { digestNames, protectedHashes } from "../../../scripts/lib/native-originals.mjs";

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


test("four protected byte expectations, not descriptor approval, are required", async t => {
  const f=await trustFixture("staging");t.after(()=>rm(f.repo,{recursive:true,force:true}));
  await assert.rejects(loadSdkTrust({target:"staging",repoRoot:f.repo}), /four protected/);
});
// SYNTHETIC UNIT fixtures, not authenticated originals or real CI identity.
// These must refuse regardless of GITHUB_ACTIONS or valid ambient public pins.
for (const [label,hashes] of [["undefined",undefined],["null",null],["empty",{}]]) test(label+" explicit hash input cannot borrow ambient CI pins",async t=>{
  const f=await trustFixture("staging");t.after(()=>rm(f.repo,{recursive:true,force:true}));
  await assert.rejects(loadSdkTrust({target:"staging",repoRoot:f.repo,hashes}),/^Error: Refusing native originals: four protected per-environment original SHA256 values required$/);
});
for (const target of ["staging","production"]) for (const field of digestNames) test(target+" missing "+field+" refuses without ambient fallback",async t=>{
  const f=await trustFixture(target);t.after(()=>rm(f.repo,{recursive:true,force:true}));
  const hashes={...f.hashes};delete hashes[field];
  await assert.rejects(loadSdkTrust({target,repoRoot:f.repo,hashes}),/four protected/);
});
for (const field of digestNames) test("production "+field+" mismatch refuses",async t=>{
  const f=await trustFixture("production");t.after(()=>rm(f.repo,{recursive:true,force:true}));
  await assert.rejects(loadSdkTrust({target:"production",repoRoot:f.repo,hashes:{...f.hashes,[field]:"0".repeat(64)}}),/mismatch|differs/);
});
for (const target of ["staging","production"]) test(target+" intake cannot become the other environment by path/default",async t=>{
  const f=await trustFixture(target);t.after(()=>rm(f.repo,{recursive:true,force:true}));
  const other=target==="staging"?"production":"staging";
  await writeFile(join(f.repo,"config/native-publish",other+".json"),await readFile(join(f.repo,"config/native-publish",target+".json")));
  await assert.rejects(loadSdkTrust({target:other,repoRoot:f.repo,hashes:f.hashes}),/approved source intake input/);
});
for (const target of [undefined,"","lab","qa","toString","__proto__"]) test(String(target)+" target refuses; no implicit production/ambient target",async()=>{
  await assert.rejects(loadSdkTrust({target,repoRoot:"unread-fixture-path",hashes:{}}),/unknown target; no LAB retarget/);
});
test("CLI environment-reader default is intentional; explicit empty input never uses it",()=>{
  const ambient=Object.fromEntries(digestNames.map(name=>[name,process.env[name]]));
  if(Object.values(ambient).every(value=>/^[a-f0-9]{64}$/.test(value??""))){
    assert.deepEqual(protectedHashes(),ambient);assert.deepEqual(protectedHashes(undefined),ambient);
  }else{
    assert.throws(()=>protectedHashes(),/four protected/);assert.throws(()=>protectedHashes(undefined),/four protected/);
  }
  assert.throws(()=>protectedHashes({}),/four protected/);
});
for (const target of ["staging","production"]) test(target+" canonical original archives, lock, ALL installed members and raw asset bind", async t => {
  const f=await trustFixture(target);t.after(()=>rm(f.repo,{recursive:true,force:true}));
  const trust=await loadSdkTrust({target,repoRoot:f.repo,hashes:f.hashes,installed:true});
  assert.deepEqual(trust.protectedHashes,f.hashes); // Explicit fixture inputs, never ambient CI values.
  assert.equal(trust.release.environment,target);
  assert.equal(trust.release.assetSha256,f.hashes.NATIVE_TRUST_ASSET_SHA256);
  assert.equal(trust.nativeAssets["runtime.wasm"].sha256,sha256("runtime.wasm"));
});
for (const field of ["NATIVE_SDK_SHA256","NATIVE_UI_SHA256","NATIVE_PROTOCOL_SHA256","NATIVE_TRUST_ASSET_SHA256"]) test(field+" mismatch refuses",async t=>{
  const f=await trustFixture("staging");t.after(()=>rm(f.repo,{recursive:true,force:true}));
  await assert.rejects(loadSdkTrust({target:"staging",repoRoot:f.repo,hashes:{...f.hashes,[field]:"0".repeat(64)}}),/mismatch|differs/);
});
for (const key of ["sdk","ui","connect-protocol"]) test("ALL installed "+key+" members reject mutation and extras before execution",async t=>{
  const f=await trustFixture("staging");t.after(()=>rm(f.repo,{recursive:true,force:true}));
  const file=join(f.app,"node_modules/@mdbase-dev",key,key==="sdk"?"dist/application/packaged-trust.js":"index.js");
  await writeFile(file,"tampered");
  await assert.rejects(loadSdkTrust({target:"staging",repoRoot:f.repo,hashes:f.hashes,installed:true}),/installed original members/);
});
test("LAB target, missing originals and lock substitution refuse",async t=>{
  const f=await trustFixture("staging");t.after(()=>rm(f.repo,{recursive:true,force:true}));
  await assert.rejects(loadSdkTrust({target:"lab",repoRoot:f.repo,hashes:f.hashes}),/no LAB/);
  await writeFile(join(f.repo,"pnpm-lock.yaml"),"lockfileVersion: 9");
  await assert.rejects(loadSdkTrust({target:"staging",repoRoot:f.repo,hashes:f.hashes}),/lock|pin/);
});
test("unsigned context replacement and raw asset vs module/context confusion refuse", async t=>{
  const f=await trustFixture("staging");t.after(()=>rm(f.repo,{recursive:true,force:true}));
  const context=join(f.packet,"next-trust/staging-context.json");
  await assert.rejects(loadSdkTrust({target:"staging",repoRoot:f.repo,hashes:{...f.hashes,NATIVE_TRUST_ASSET_SHA256:sha256(await readFile(context))}}),/RAW signed asset/);
  await writeFile(context,(await readFile(context,"utf8")).replace("https://connect-staging.mdbase.dev","https://connect-lab.mdbase.dev"));
  await assert.rejects(loadSdkTrust({target:"staging",repoRoot:f.repo,hashes:f.hashes}),/CP\/source context/);
});
test("guard CLI binds exact source/tree/event and refuses missing target custody",async t=>{
 const f=await trustFixture("staging");t.after(()=>rm(f.repo,{recursive:true,force:true}));
 git(f.repo,"init","-b","release/native-staging");git(f.repo,"config","user.email","test@example.invalid");git(f.repo,"config","user.name","Test");git(f.repo,"add",".");git(f.repo,"commit","-m","original fixture");
 const sha=git(f.repo,"rev-parse","HEAD");
 const plan=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL("./native-publisher.mjs",import.meta.url)),"guard","--target","staging","--sha",sha,"--repo-root",f.repo],{encoding:"utf8",env:{...process.env,...f.hashes,GITHUB_EVENT_NAME:"workflow_dispatch",GITHUB_REF:"refs/heads/release/native-staging",GITHUB_SHA:sha}}));
 assert.equal(plan.sha,sha);assert.equal(plan.tree,git(f.repo,"rev-parse","HEAD^{tree}"));
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
    await assert.rejects(buildAssetInventory(dist), /symlink/u);
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
  assert.equal(createReceipt({ ...args, deploymentId: "12345678-1234-1234-1234-123456789abc", verification: { ok: true } }).status, "failed-or-incomplete");
  const inventory=[{path:"index.html",bytes:1,sha256:"e".repeat(64)}];
  const verified={ok:true,verified:inventory,failures:[],unverified:[]};
  assert.equal(createReceipt({...args,inventory,deploymentId:"12345678-1234-1234-1234-123456789abc",verification:verified}).status,"failed-or-incomplete");
  assert.equal(createReceipt({...args,inventory,deploymentId:"12345678-1234-1234-1234-123456789abc",verification:{...verified,unverified:[inventory[0]]}}).status,"failed-or-incomplete");
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


test("all static bytes pass but hosting controls and executing worker remain blocking",async t=>{
 const dist=await distFixture({...DIST_FILES,"_worker.js":"export default worker;"});t.after(()=>rm(dist,{recursive:true,force:true}));
 const inventory=await buildAssetInventory(dist);
 const fetch=async url=>{
  const path=new URL(url).pathname;
  const name=path==="/"?"index.html":path.slice(1);
  return new Response(DIST_FILES[name],{status:DIST_FILES[name]===undefined?404:200});
 };
 const result=await verifyServedAssets({origin:"https://staging.mdbase-writer.pages.dev",inventory,fetch,attempts:1});
 assert.equal(result.ok,false);assert.equal(result.failures.length,0);
 assert.deepEqual(result.unverified.map(a=>a.path).sort(),["_routes.json","_worker.js"]);
 assert.ok(result.verified.some(a=>a.path===".well-known/mdbase-app.json"));
});
test("every servable HTML manifest JS trust SQLite WASM mismatch blocks",async t=>{
 const dist=await distFixture(DIST_FILES);t.after(()=>rm(dist,{recursive:true,force:true}));
 const inventory=(await buildAssetInventory(dist)).filter(a=>a.path!=="_routes.json");
 for(const broken of inventory) {
  const result=await verifyServedAssets({origin:"https://staging.mdbase-writer.pages.dev",inventory,attempts:1,fetch:async url=>{
    const name=new URL(url).pathname==="/"?"index.html":new URL(url).pathname.slice(1);
    return new Response(name===broken.path?"tamper":DIST_FILES[name]);
  }});
  assert.equal(result.ok,false,broken.path);assert.ok(result.failures.some(a=>a.path===broken.path),broken.path);
 }
});
test("empty inventory and unapproved origins cannot verify",async()=>{
 await assert.rejects(verifyServedAssets({origin:"https://staging.mdbase-writer.pages.dev",inventory:[]}),/categories/);
 await assert.rejects(verifyServedAssets({origin:"https://evil.example",inventory:[]}),/non-target/);
});
