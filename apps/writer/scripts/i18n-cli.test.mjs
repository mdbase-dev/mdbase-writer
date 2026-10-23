import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("the packed i18n CLI executes and rejects invalid commands rather than silently succeeding", () => {
  const result = spawnSync(process.execPath, ["scripts/i18n.mjs", "definitely-not-a-command"], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage: mdbase-i18n/);
});
