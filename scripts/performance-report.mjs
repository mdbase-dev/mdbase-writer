import { execFileSync } from "node:child_process";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export async function bundleMetrics(directory) {
  const root = await realpath(directory);
  const html = await readFile(resolve(root, "index.html"), "utf8");
  const metrics = [];
  for (const [kind, pattern] of [
    ["js", /<(?:script|link)\b[^>]+(?:src|href)="([^"]+\.m?js)"/g],
    ["css", /<link\b[^>]+href="([^"]+\.css)"/g],
  ]) {
    const references = [...new Set([...html.matchAll(pattern)].map((match) => match[1]))];
    if (!references.length) throw new Error("Initial assets are missing from the production build");
    let value = 0;
    for (const reference of references) {
      const decoded = decodeURIComponent(reference);
      if (/^[a-z][a-z0-9+.-]*:/i.test(decoded) || decoded.startsWith("//") || /[?#\\]/.test(decoded)
        || decoded.split("/").some((part) => part === "." || part === "..")) throw new Error("Expected a local distribution asset");
      const path = await realpath(resolve(root, decoded.replace(/^\//, "")));
      if (!path.startsWith(root + sep)) throw new Error("Asset escapes the distribution");
      value += gzipSync(await readFile(path), { level: 9 }).length;
    }
    metrics.push({ name: "writer.initial-" + kind + ".gzip", unit: "bytes", value });
  }
  return metrics;
}

export function report(metrics, { commit, commitAt }, env = process.env) {
  if (env.GITHUB_REPOSITORY !== "mdbase-dev/mdbase-writer" || env.GITHUB_REF !== "refs/heads/main"
    || env.GITHUB_EVENT_NAME !== "push" || env.GITHUB_SHA !== commit
    || !Number.isSafeInteger(Number(env.GITHUB_RUN_ID)) || Number(env.GITHUB_RUN_ID) < 1
    || !Number.isSafeInteger(Number(env.GITHUB_RUN_ATTEMPT)) || Number(env.GITHUB_RUN_ATTEMPT) < 1
    || !/^[0-9a-f]{40}$/.test(commit) || !Number.isFinite(Date.parse(commitAt))
    || !["X64", "ARM64"].includes(env.RUNNER_ARCH)) throw new Error("Expected the exact main-branch production build");
  return { schema_version: 1, repo: "writer", suite: "sizes", run_id: Number(env.GITHUB_RUN_ID), attempt: Number(env.GITHUB_RUN_ATTEMPT),
    commit, commit_at: new Date(commitAt).toISOString(),
    observed_at: new Date().toISOString(), runner: "ubuntu-24.04-" + env.RUNNER_ARCH.toLowerCase(), conclusion: "success", metrics };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.length !== 4) throw new Error("Usage: node scripts/performance-report.mjs DIST OUTPUT_JSON");
  const source = { commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    commitAt: execFileSync("git", ["show", "-s", "--format=%cI", "HEAD"], { encoding: "utf8" }).trim() };
  await writeFile(process.argv[3], JSON.stringify(report(await bundleMetrics(process.argv[2]), source)) + "\n");
}

