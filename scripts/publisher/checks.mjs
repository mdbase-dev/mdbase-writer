import { inventoryDirectory } from '../lib/native-publish-bytes.mjs';
import { writerDeployments } from '../../apps/writer/scripts/deployment-environment.mjs';
export function classifyAsset(path) {
  if (path === ".well-known/mdbase-app.json") return "manifest";
  if (path.startsWith(".well-known/") || /trust/iu.test(path)) return "trust";
  if (/\.html?$/iu.test(path)) return "html";
  if (/\.wasm$/iu.test(path)) return "wasm";
  if (/\.(sqlite3?|db)$/iu.test(path)) return "sqlite";
  if (/\.(m?js|cjs)$/iu.test(path)) return "js";
  return "other";
}

export const requiredAssetCategories = Object.freeze(["html", "manifest", "js", "wasm"]);

export async function buildAssetInventory(distDir) {
  return (await inventoryDirectory(distDir, { maxFileBytes: 25 * 1024 * 1024 })).map(asset => ({ ...asset, category: classifyAsset(asset.path) }));
}

export function assertInventoryCoverage(inventory, sdkTrust) {
  for (const asset of inventory) {
    if (!asset.path || asset.path.split("/").some((part) => !part || part === "." || part === "..") || !/^[0-9a-f]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0) throw new Error("Invalid asset inventory; refusing.");
    if (asset.bytes > 25 * 1024 * 1024) throw new Error(`Asset ${asset.path} exceeds Pages' 25 MiB limit`);
  }
  if (new Set(inventory.map((a) => a.path)).size !== inventory.length) throw new Error("Duplicate inventory paths; refusing");
  for (const [name, pin] of Object.entries(sdkTrust?.nativeAssets ?? {})) {
    if (!inventory.some((asset) => asset.sha256 === pin.sha256 && asset.bytes === pin.bytes)) throw new Error(`Missing exact SDK native/SQLite bytes for ${name}; refusing`);
  }
  if (sdkTrust && !inventory.some(asset => asset.path === "_worker.js" || asset.path === "_worker.js/index.js")) throw new Error("Missing precompiled Pages Worker; refusing");
  const present = new Set(inventory.map((asset) => classifyAsset(asset.path)));
  const missing = requiredAssetCategories.filter((category) => !present.has(category));
  if (missing.length > 0) throw new Error(`Built assets are missing required categories: ${missing.join(", ")}; refusing to upload.`);
}

export function assertBuiltTarget({ target, manifest, routes }) {
  if (!['staging','production'].includes(target)) throw Error('Unknown target');
  const origin = writerDeployments[target].origin;
  if (manifest.homepage !== `${origin}/` || manifest.redirect_uris?.length !== 1 || manifest.redirect_uris[0] !== `${origin}/` || !manifest.installation_origins?.[target]?.["app-runtime"]?.includes(origin)) throw new Error("Refusing: built manifest is not bound to the exact target");
  if (routes.version !== 1 || routes.include?.length !== 1 || routes.include[0] !== "/wasm/*" || routes.exclude?.length !== 0) throw new Error("Refusing: Pages Functions must remain limited to /wasm/*");
}
