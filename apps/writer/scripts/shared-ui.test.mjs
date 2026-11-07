import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import test from "node:test";

test("uses shared overlay lifecycles without the local adapter", () => {
  const app = new URL("../", import.meta.url);
  const read = path => readFileSync(new URL(path, app), "utf8");
  const dependencies = JSON.parse(read("package.json")).dependencies;
  assert.equal(dependencies["@mdbase-dev/ui"], "0.1.0-beta.158");
  assert.equal(dependencies["@mdbase-dev/i18n"], "0.1.0-beta.158");
  assert.equal(existsSync(new URL("src/ui/overlays.tsx", app)), false);
  const patch = read("../../patches/@mdbase-dev__ui@0.1.0-beta.158.patch");
  assert.doesNotMatch(patch, /dist\/overlay|dist\/CommandPalette\.d\.ts/);
  assert.match(patch, /dist\/Dialog\.js/);
  assert.doesNotMatch(patch, /present = open|readonly present|\.animate\(/);
  assert.match(read("src/ui/Home.tsx"), /import \{ CommandPalette \} from "@mdbase-dev\/ui\/command-palette"/);
  assert.match(read("src/ui/WorkspaceView.tsx"), /import \{ Dialog \} from "@mdbase-dev\/ui\/dialog"/);
  assert.match(read("src/ui/Settings.tsx"), /import \{ useOverlay \} from "@mdbase-dev\/ui\/overlay"/);
});
