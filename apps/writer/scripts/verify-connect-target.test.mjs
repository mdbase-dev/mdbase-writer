import assert from "node:assert/strict";
import test from "node:test";

import { assertConnectTarget, connectTargetsIn } from "./verify-connect-target.mjs";

const trust = (environment, cpOrigin) =>
  `var Fh={schema:\`mdbn-app-trust/release/1\`,environment:\`${environment}\`,cpOrigin:\`${cpOrigin}\`,logOrigin:\`https://log.example\`};`;

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

test("refuses a foreign Connect origin, a missing trust and unknown targets", () => {
  assert.throws(
    () => assertConnectTarget("staging", [trust("staging", "https://connect-staging.mdbase.dev"), '??"https://connect.mdbase.dev"']),
    /references Connect https:\/\/connect\.mdbase\.dev/,
  );
  assert.throws(() => assertConnectTarget("production", [trust("production", "https://connect.mdbase.dev"), "https://connect-lab.mdbase.dev"]), /connect-lab/);
  assert.throws(() => assertConnectTarget("staging", ["https://connect-staging.mdbase.dev"]), /No packaged SDK release trust/);
  assert.throws(() => assertConnectTarget("qa", []), /Unsupported/);
});
