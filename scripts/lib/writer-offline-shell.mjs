// Build-output DATA verification only; no eval/import of SDK/Worker source.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { inventoryDirectory } from './native-publish-bytes.mjs';
import { originalMembers } from './native-originals.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const requireValue=(ok,reason)=>{if(!ok)throw Error('Offline shell refusal: '+reason);};
const worker='mdbase-shell-sw.js',runtime='mdbase-shell-runtime.js',registration='mdbase-shell-register.js';
export async function assertWriterOfflineShell({directory,repoRoot,sdkTrust}) {
 const inventory=await inventoryDirectory(directory),byPath=new Map(inventory.map(a=>[a.path,a]));
 const swEntry=byPath.get(worker);
 requireValue(swEntry&&swEntry.bytes<=1024*1024,'bounded actual inline worker manifest');
 const sw=await readFile(join(directory,worker),'utf8');
 const match=/^\n\/\/ mdbase shared offline shell\nimport \{installOfflineShell\} from "\.\/mdbase-shell-runtime\.js";\ninstallOfflineShell\(self, (.+)\);\n$/.exec(sw);
 requireValue(match,'canonical original default-worker inline manifest (not offline-assets.json)');
 let manifest;try{manifest=JSON.parse(match[1]);}catch{}
 requireValue(manifest&&JSON.stringify(manifest)===match[1]&&isDeepStrictEqual(Object.keys(manifest),['base','version','assets'])&&manifest.base==='/'&&/^[a-f0-9]{64}$/.test(manifest.version)&&Array.isArray(manifest.assets)&&manifest.assets.length<=20000,'canonical bounded JSON DATA');
 const eligible=inventory.filter(a=>a.path!==worker&&!a.path.split('/').some(s=>s.startsWith('.')||s.startsWith('_'))&&/\.(?:html|js|mjs|css|wasm|woff2?|ttf|svg|png|webp|jpg|jpeg|ico|json|webmanifest)$/.test(a.path)).map(a=>({path:a.path,sha256:a.sha256}));
 for(const a of manifest.assets)requireValue(a&&isDeepStrictEqual(Object.keys(a),['path','sha256'])&&typeof a.path==='string'&&a.path.length<=512&&/^[A-Za-z0-9_.@/-]+$/.test(a.path)&&!a.path.split('/').some(s=>!s||s==='.'||s==='..')&&/^[a-f0-9]{64}$/.test(a.sha256),'safe cache asset path/hash');
 requireValue(isDeepStrictEqual(manifest.assets,eligible)&&manifest.assets.some(a=>a.path==='index.html'),'ALL actual cache-eligible final bytes, no duplicates/missing/extra');
 requireValue(manifest.version===hash(JSON.stringify({base:'/',assets:manifest.assets,existing:''})),'version binds exact canonical assets/base/original empty worker');
 const sdk=sdkTrust.archives.sdk,archive=join(repoRoot,sdk.path),bytes=await readFile(archive);
 requireValue(hash(bytes)===sdk.sha256,'independently bound original SDK unchanged');
 const members=originalMembers(archive),original=members.find(a=>a.path==='dist/offline-shell-worker.js');
 requireValue(original,'original shared shell runtime member');
 const raw=execFileSync('tar',['-xOzf',archive,'package/dist/offline-shell-worker.js'],{maxBuffer:128*1024*1024});
 requireValue(raw.length===original.bytes&&hash(raw)===original.sha256,'original shell runtime inventory');
 // EXACT transformation in original offline-shell-build.js; no alias output.
 const expected=Buffer.from(raw.toString('utf8').replace(/\n\/\/# sourceMappingURL=.*$/m,''));
 requireValue(byPath.get(runtime)?.bytes===expected.length&&byPath.get(runtime)?.sha256===hash(expected),'original shell runtime bytes (only original source-map removal)');
 const register=`if ("serviceWorker" in navigator) navigator.serviceWorker.register("/${worker}", {scope:"/",type:"module"}).catch(() => console.warn("Offline app support could not start."));\n`;
 requireValue(byPath.get(registration)?.sha256===hash(register),'exact original root registration bytes');
 const html=await readFile(join(directory,'index.html'),'utf8');
 requireValue(html.includes('<script type="module" src="/mdbase-shell-register.js"></script>'),'actual HTML registration');
 // Full post-build inventory is independent of the cache list. Hidden manifest,
 // route controls, compiled Pages Worker and every extra asset stay inventoried.
 return {worker,version:manifest.version,cacheAssets:manifest.assets.length,cacheInventorySha256:hash(JSON.stringify(manifest.assets)),originalRuntime:{path:runtime,bytes:expected.length,sha256:hash(expected)},inventory};
}
