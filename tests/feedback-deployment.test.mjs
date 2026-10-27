import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("legacy and native Writer builds retain matching public feedback configuration", async () => {
  const workflow = await readFile(new URL("../.github/workflows/deploy-writer.yml", import.meta.url), "utf8");
  const legacy = workflow.split("\n  deploy:")[1].split("\n  native-dispatch:")[0];
  const native = workflow.split("\n  native-build:")[1].split("\n  native-deploy:")[0];
  for (const job of [legacy, native]) {
    assert.ok(job.includes("VITE_MDBASE_FEEDBACK_URL: " + "${{ inputs.target == 'production' && 'https://feedback-api.mdbase.dev/v1/feedback' || 'https://feedback-api-staging.mdbase.dev/v1/feedback' }}"));
    assert.ok(job.includes("VITE_MDBASE_FEEDBACK_TURNSTILE_SITE_KEY: " + "${{ inputs.target == 'production' && '0x4AAAAAAEboz_mLT-taI3H-' || '0x4AAAAAAEbkvA4d9vQJq2D1' }}"));
  }
});
