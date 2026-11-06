import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";

import { assertConnectTarget, connectTargetsIn } from "./verify-connect-target.mjs";

const trust = (environment, cpOrigin) =>
  `var Fh={schema:\`mdbn-app-trust/release/1\`,environment:\`${environment}\`,cpOrigin:\`${cpOrigin}\`,logOrigin:\`https://log.example\`};`;

test("the CLI refuses to skip verification without an environment", () => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VITE_)?MDBASE_/.test(name)));
  const result = spawnSync(process.execPath, [new URL("verify-connect-target.mjs", import.meta.url).pathname], { env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Select VITE_MDBASE_ENV/);
});

test("finds packaged SDK trust and every Connect origin literal", () => {
  const found = connectTargetsIn([trust("staging", "https://connect-staging.mdbase.dev"), 'fetch("https://connect.mdbase.dev/v1")']);
  assert.deepEqual(found.trusts, [{ environment: "staging", cpOrigin: "https://connect-staging.mdbase.dev" }]);
  assert.deepEqual(found.origins, ["https://connect-staging.mdbase.dev", "https://connect.mdbase.dev"]);
});

test("accepts a bundle bound only to its target's Connect", () => {
  assert.deepEqual(assertConnectTarget("staging", [trust("staging", "https://connect-staging.mdbase.dev")]), {
    target: "staging",
    connectOrigin: "https://connect-staging.mdbase.dev",
    trusts: 1,
  });
  assert.equal(assertConnectTarget("production", [trust("production", "https://connect.mdbase.dev"), "x='https://connect.mdbase.dev'"]).connectOrigin, "https://connect.mdbase.dev");
});

test("refuses the observed staging bundle that packages production trust", () => {
  // staging.mdbase-writer.pages.dev /assets/index-BQgb40yv.js on 2026-11-02.
  assert.throws(() => assertConnectTarget("staging", [trust("production", "https://connect.mdbase.dev")]), /packages production trust for https:\/\/connect\.mdbase\.dev/);
});

test("refuses sibling-app fallbacks and cross-environment handoffs", () => {
  for (const [target, connect, editor, reader] of [
    ["lab", "https://connect-lab.mdbase.dev", "https://editor-lab.mdbase.dev", "https://lab.mdbase-reader.pages.dev"],
    ["staging", "https://connect-staging.mdbase.dev", "https://editor-staging.mdbase.dev", "https://staging.mdbase-reader.pages.dev"],
  ]) {
    const sources = [trust(target, connect), `editor='${editor}'; reader='${reader}'`];
    assert.doesNotThrow(() => assertConnectTarget(target, sources));
    for (const origin of ["https://editor.mdbase.dev", "https://reader.mdbase.dev", "https://writer.mdbase.dev", "https://foreign.mdbase-reader.pages.dev"]) {
      assert.throws(() => assertConnectTarget(target, [...sources, origin]), /foreign apps/);
    }
  }
});

test("allows only the exact inert Writer origin declarations, not adjacent handoffs", () => {
  const declarations = 'const origins={lab:"https://lab.mdbase-writer.pages.dev",staging:"https://staging.mdbase-writer.pages.dev",production:"https://writer.mdbase.dev"};';
  const sources = [trust("lab", "https://connect-lab.mdbase.dev"), declarations];
  assert.doesNotThrow(() => assertConnectTarget("lab", sources));
  assert.throws(() => assertConnectTarget("lab", [...sources, 'href="https://writer.mdbase.dev"']), /foreign apps/);
});

test("refuses a foreign Connect origin, a missing trust and unknown targets", () => {
  assert.throws(
    () => assertConnectTarget("staging", [trust("staging", "https://connect-staging.mdbase.dev"), '??"https://connect.mdbase.dev"']),
    /references Connect https:\/\/connect\.mdbase\.dev/,
  );
  assert.throws(() => assertConnectTarget("production", [trust("production", "https://connect.mdbase.dev"), "https://connect-lab.mdbase.dev"]), /connect-lab/);
  assert.throws(() => assertConnectTarget("staging", ["https://connect-staging.mdbase.dev"]), /No packaged SDK release trust/);
  assert.throws(() => assertConnectTarget("qa", []), /Unsupported/);
});
