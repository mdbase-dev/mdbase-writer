import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// beta.141's CLI entry guard does not follow pnpm's bin symlink. Execute the
// pinned package's real file so its guard runs; do not bypass any kit checks.
// Remove this launcher when the published kit fixes its CLI entry guard.
const cli = fileURLToPath(new URL("./cli.mjs", import.meta.resolve("@mdbase-dev/i18n/config")));
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
