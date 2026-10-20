// Shared byte verifier is unchanged. Hosting controls and executing Pages Worker
// are NOT static GET evidence. Pending trusted runtime/header policy stays BLOCKING.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { verifyServedBytes } from '../../../scripts/lib/native-publish-bytes.mjs';
import { assertInventoryCoverage } from './native-publisher.mjs';
export const isFetchableAsset = path => !['_routes.json','_headers','_redirects'].includes(path.split('/').at(-1)) && path !== '_worker.js' && !path.startsWith('_worker.js/');
export function servedUrlFor(origin, path) {
  if (path === 'index.html') return origin + '/';
  return origin + '/' + (path.endsWith('.html') ? path.slice(0,-5) : path);
}
export async function verifyServedAssets({ origin, inventory, ...options }) {
  if (!['https://staging.mdbase-writer.pages.dev','https://writer.mdbase.dev'].includes(origin)) throw Error('Refusing non-target verification origin');
  assertInventoryCoverage(inventory);
  const worker = inventory.filter(a => a.path === '_worker.js' || a.path.startsWith('_worker.js/'));
  const staticInventory = inventory.filter(a => !worker.includes(a));
  // Trusted source mapping, never artifact-supplied. Pages serves 404.html as /404.
  const urlMapping = Object.fromEntries(staticInventory.filter(a => a.path.endsWith('.html') && a.path !== 'index.html').map(a => [a.path, servedUrlFor(origin, a.path)]));
  const result = await verifyServedBytes(origin, staticInventory, { ...options, urlMapping });
  result.unverified.push(...worker.map(a => ({ ...a, reason:'executing-worker-requires-trusted-runtime-policy-check' })));
  return { ...result, ok: result.failures.length === 0 && result.unverified.length === 0 && result.verified.length === inventory.length };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = Object.fromEntries(process.argv.slice(2).reduce((pairs,v,i,a) => i % 2 ? pairs : [...pairs,[v.slice(2),a[i+1]]], []));
  try {
    const result = await verifyServedAssets({ origin:args.origin, inventory:JSON.parse(await readFile(args.inventory,'utf8')) });
    console.log(JSON.stringify(result,null,2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) { console.log(JSON.stringify({ok:false,error:error.message})); process.exitCode = 1; }
}
