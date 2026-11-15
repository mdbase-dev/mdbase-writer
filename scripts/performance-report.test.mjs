import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { bundleMetrics, report } from "./performance-report.mjs";

test("initial gzip sizes are deduplicated and exclude lazy assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "performance-fixture-"));
  try {
    await writeFile(join(root, "index.html"), '<script src="/main.js"></script><link rel="modulepreload" href="/main.js"><link href="/main.css">');
    await writeFile(join(root, "main.js"), "export default 1;");
    await writeFile(join(root, "main.css"), "body{}");
    await writeFile(join(root, "lazy.js"), "not counted");
    assert.deepEqual(await bundleMetrics(root), [
      { name: "writer.initial-js.gzip", unit: "bytes", value: gzipSync("export default 1;", { level: 9 }).length },
      { name: "writer.initial-css.gzip", unit: "bytes", value: gzipSync("body{}", { level: 9 }).length },
    ]);
    for (const reference of ["https://example.com/main.js", "/../main.js", "/%2e%2e/main.js", "//outside/main.js"]) {
      await writeFile(join(root, "index.html"), '<script src="' + reference + '"></script><link href="/main.css">');
      await assert.rejects(bundleMetrics(root), /local/);
    }
    await symlink(join(root, ".."), join(root, "escape"));
    await writeFile(join(root, "index.html"), '<script src="/escape/main.js"></script><link href="/main.css">');
    await assert.rejects(bundleMetrics(root));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("only exact main-branch builds can claim provenance", () => {
  const commit = "a".repeat(40);
  const source = { commit, commitAt: "2026-11-15T12:00:00Z" };
  const env = { GITHUB_REPOSITORY: "mdbase-dev/mdbase-writer", GITHUB_REF: "refs/heads/main", GITHUB_EVENT_NAME: "push",
    GITHUB_SHA: commit, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1", RUNNER_ARCH: "X64" };
  assert.equal(report([], source, env).commit, commit);
  for (const patch of [{ GITHUB_EVENT_NAME: "pull_request" }, { GITHUB_SHA: "b".repeat(40) }, { GITHUB_REF: "refs/pull/1/merge" }, { GITHUB_RUN_ID: "0" }]) {
    assert.throws(() => report([], source, { ...env, ...patch }));
  }
});

