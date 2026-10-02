// Builds mdbase writer for a deployment target and uploads it to Cloudflare
// Pages. Usage: MDBASE_ENV=lab|staging|production node scripts/deploy-pages.mjs
import { execFileSync, spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { assertReproducibleDeployment, pagesProject, writerDeploymentFor } from "./deployment-environment.mjs";

const root = resolve(import.meta.dirname, "..");
const { target, deployment } = writerDeploymentFor(process.env);
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
assertReproducibleDeployment(target, git("status", "--porcelain", "--untracked-files=all"), process.env);
const commit = git("rev-parse", "--short=12", "HEAD");
const PAGES_FILE_LIMIT = 25 * 1024 * 1024;

await run("pnpm", ["build"], {
  ...process.env,
  MDBASE_WRITER_ORIGIN: deployment.origin,
  VITE_MDBASE_ENV: target,
  VITE_MDBASE_WRITER_BUILD_ID: commit,
  VITE_MDBASE_CONNECT_URL: deployment.connectUrl,
  VITE_MDBASE_CONNECT_LOOPBACK_URL: deployment.loopbackUrl,
  ...(deployment.demo ? { VITE_WRITER_DEMO: "1" } : {}),
});
await verify();
await run("pnpm", ["dlx", "wrangler@4.120.0", "pages", "deploy", "dist", "--project-name", pagesProject, "--branch", deployment.branch, "--commit-hash", commit, "--commit-dirty=true"]);
console.log(`Deployed ${target}: ${deployment.origin}/`);

async function verify() {
  const manifest = JSON.parse(await readFile(join(root, "dist", ".well-known", "mdbase-app.json"), "utf8"));
  const home = `${deployment.origin}/`;
  if (manifest.homepage !== home || manifest.redirect_uris?.[0] !== home || manifest.redirect_uris.length !== 1) {
    throw new Error(`The built manifest does not declare ${home}.`);
  }
  for (const file of await files(join(root, "dist"))) {
    const size = (await stat(file)).size;
    if (size > PAGES_FILE_LIMIT) throw new Error(`${file} is ${size} bytes, over Pages' 25 MiB limit.`);
  }
  const routes = JSON.parse(await readFile(join(root, "dist", "_routes.json"), "utf8"));
  if (routes.include?.join() !== "/wasm/*") throw new Error("Functions must be limited to /wasm/*.");
}

async function files(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await files(path)));
    else out.push(path);
  }
  return out;
}

function run(command, args, env = process.env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolveRun() : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`))));
  });
}
