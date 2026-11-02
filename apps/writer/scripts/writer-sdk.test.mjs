import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { writerDeployments } from "./deployment-environment.mjs";
import { verifiedWriterSdk, writerSdkTarget } from "./writer-sdk.mjs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const app = fileURLToPath(new URL("../", import.meta.url));

test("selects only an explicit, consistent build environment", () => {
  assert.equal(writerSdkTarget({}), undefined);
  assert.equal(writerSdkTarget({ VITE_MDBASE_ENV: "" }), undefined);
  assert.equal(writerSdkTarget({ VITE_MDBASE_ENV: "staging", MDBASE_ENV: "staging" }), "staging");
  assert.equal(writerSdkTarget({ MDBASE_WRITER_DEPLOY_TARGET: "production" }), "production");
  assert.equal(writerSdkTarget({ VITE_MDBASE_ENV: "staging", VITE_MDBASE_CONNECT_URL: "https://connect-staging.mdbase.dev" }), "staging");
  assert.throws(() => writerSdkTarget({ VITE_MDBASE_ENV: "staging", MDBASE_ENV: "production" }), /Conflicting/);
  assert.throws(() => writerSdkTarget({ VITE_MDBASE_ENV: "qa" }), /Unsupported/);
  assert.throws(() => writerSdkTarget({ VITE_MDBASE_ENV: "staging", VITE_MDBASE_CONNECT_URL: "https://connect.mdbase.dev" }), /requires Connect https:\/\/connect-staging/);
  assert.throws(() => writerSdkTarget({ MDBASE_ENV: "production", MDBASE_CONNECT_URL: "https://connect-staging.mdbase.dev" }), /requires Connect https:\/\/connect\.mdbase/);
  assert.throws(() => writerSdkTarget({ VITE_MDBASE_CONNECT_URL: "https://connect.mdbase.dev" }), /without VITE_MDBASE_ENV/);
});

test("each environment builds against its own verified SDK original and Connect origin", async () => {
  for (const target of ["lab", "staging", "production"]) {
    const sdk = await verifiedWriterSdk(target);
    assert.equal(sdk.connectOrigin, writerDeployments[target].connectUrl);
    assert.equal(sdk.name, target === "production" ? "@mdbase-dev/sdk" : `@mdbase-dev/sdk-${target}`);
    const main = sdk.aliases.find(({ find }) => find.test("@mdbase-dev/sdk"));
    assert.ok(main?.replacement.startsWith(sdk.root));
    assert.ok(!sdk.aliases.some(({ find }) => find.test("@mdbase-dev/sdk-legacy")));
  }
});

test("a staging build refuses when only the production SDK is installed", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "writer-sdk-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(join(fixture, "node_modules", "@mdbase-dev"), { recursive: true });
  await symlink(await realpath(join(app, "node_modules/@mdbase-dev/sdk")), join(fixture, "node_modules/@mdbase-dev/sdk"));
  await assert.rejects(verifiedWriterSdk("staging", repoRoot, fixture), /No installed SDK is packaged for staging .*production, https:\/\/connect\.mdbase\.dev/);
  assert.equal((await verifiedWriterSdk("production", repoRoot, fixture)).connectOrigin, "https://connect.mdbase.dev");
});

test("a native release branch that installs its target SDK as @mdbase-dev/sdk uses it directly", async (t) => {
  const fixture = await mkdtemp(join(tmpdir(), "writer-sdk-"));
  t.after(() => rm(fixture, { recursive: true, force: true }));
  await mkdir(join(fixture, "node_modules", "@mdbase-dev"), { recursive: true });
  await symlink(await realpath(join(app, "node_modules/@mdbase-dev/sdk-staging")), join(fixture, "node_modules/@mdbase-dev/sdk"));
  const sdk = await verifiedWriterSdk("staging", repoRoot, fixture);
  assert.equal(sdk.name, "@mdbase-dev/sdk");
  assert.equal(sdk.connectOrigin, "https://connect-staging.mdbase.dev");
});
