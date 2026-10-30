import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import test from "node:test";

const app = fileURLToPath(new URL("../", import.meta.url));
const legacy = /^@mdbase-dev\/(?:connect|connect-dev|connect-testing|connect-runtime)(?:\/|$)/;
test("Writer has one SDK intake and exact, publisher-matched UI/i18n pins", async () => {
  const manifest = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
  for (const name of Object.keys({...manifest.dependencies, ...manifest.devDependencies})) assert.equal(legacy.test(name), false, name);
  assert.ok(manifest.dependencies["@mdbase-dev/sdk"]);
  const approved = JSON.parse(await readFile(join(app, "../../config/native-publish/production.json"), "utf8"));
  const version = manifest.dependencies["@mdbase-dev/ui"];
  assert.match(version, /^\d+\.\d+\.\d+-beta\.\d+$/);
  assert.equal(manifest.dependencies["@mdbase-dev/i18n"], version);
  assert.equal(approved.ui.version, version);
});
test("Writer source has no legacy runtime imports", async () => {
  async function inspect(dir) {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {if (entry.name !== "locales") await inspect(path);}
      else if (/\.tsx?$/.test(entry.name)) {
        const source = await readFile(path, "utf8");
        for (const match of source.matchAll(/(?:from\s*|import\s*\()["']([^"']+)["']/g)) assert.equal(legacy.test(match[1]), false, path + ": " + match[1]);
      }
    }
  }
  await inspect(join(app, "src"));
});
