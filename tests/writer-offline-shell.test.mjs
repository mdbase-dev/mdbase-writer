import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import test from 'node:test';
import { assertWriterOfflineShell } from '../scripts/lib/writer-offline-shell.mjs';
import { loadOriginals } from '../scripts/lib/native-originals.mjs';
import { inventoryDirectory } from '../scripts/lib/native-publish-bytes.mjs';
import { frozenStagingRoot } from './frozen-staging-root.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex'),worker='mdbase-shell-sw.js';
async function fixture(t){
 const repoRoot=await frozenStagingRoot(t),approved=JSON.parse(await readFile(join(repoRoot,'config/native-publish/staging.json'),'utf8'));
 const sdkTrust=await loadOriginals({repoRoot,target:'staging',hashes:approved.protectedHashes});
 const archive=join(repoRoot,sdkTrust.archives.sdk.path),directory=await mkdtemp(join(tmpdir(),'writer-shell-data-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const readOriginal=p=>execFileSync('tar',['-xOzf',archive,'package/'+p],{maxBuffer:16*1024*1024});
 const source=readOriginal('dist/offline-shell-build.js').toString('utf8');
 assert.ok(source.includes('const manifest = { base, version, assets };'));assert.ok(source.includes('installOfflineShell(self, ${JSON.stringify(manifest)})'));assert.ok(source.includes('"mdbase-shell-sw.js"'));assert.ok(!source.includes('offline-assets.json'));
 const put=async(p,b)=>{await mkdir(join(directory,p,'..'),{recursive:true});await writeFile(join(directory,p),b);};
 await put('index.html','<html><head><script type="module" src="/mdbase-shell-register.js"></script></head><body>Writer</body></html>');
 await put('assets/app.js','export {};');await put('mdbase-shell-runtime.js',readOriginal('dist/offline-shell-worker.js').toString('utf8').replace(/\n\/\/# sourceMappingURL=.*$/m,''));
 await put('mdbase-shell-register.js','if ("serviceWorker" in navigator) navigator.serviceWorker.register("/mdbase-shell-sw.js", {scope:"/",type:"module"}).catch(() => console.warn("Offline app support could not start."));\n');
 for(const p of ['.well-known/mdbase-app.json','_worker.js','_routes.json','.hidden/extra.json','unlisted.dat'])await put(p,'independent final inventory '+p);
 const emit=async change=>{
  const rows=await inventoryDirectory(directory),assets=rows.filter(a=>a.path!==worker&&!a.path.split('/').some(s=>s.startsWith('.')||s.startsWith('_'))&&/\.(?:html|js|mjs|css|wasm|woff2?|ttf|svg|png|webp|jpg|jpeg|ico|json|webmanifest)$/.test(a.path)).map(a=>({path:a.path,sha256:a.sha256}));
  const value={base:'/',version:hash(JSON.stringify({base:'/',assets,existing:''})),assets};if(change)change(value);
  await put(worker,'\n// mdbase shared offline shell\nimport {installOfflineShell} from "./mdbase-shell-runtime.js";\ninstallOfflineShell(self, '+JSON.stringify(value)+');\n');return value;
 };
 await emit();return {directory,repoRoot,sdkTrust,put,emit};
}
test('actual original SDK builder DATA shape: inline JSON and original shell runtime, independent full final inventory',async t=>{
 const f=await fixture(t),result=await assertWriterOfflineShell(f);
 assert.equal(result.cacheAssets,4);assert.equal(result.inventory.length,10);
 for(const path of ['.well-known/mdbase-app.json','_worker.js','_routes.json','.hidden/extra.json','unlisted.dat',worker])assert.ok(result.inventory.some(a=>a.path===path));
 assert.ok(result.originalRuntime.bytes>1000);assert.equal(result.originalRuntime.path,'mdbase-shell-runtime.js');
});
for(const kind of ['version','path','duplicate','missing','hash','base','eval'])test('inline manifest '+kind+' substitution refuses as DATA',async t=>{
 const f=await fixture(t);
 if(kind==='eval')await f.put(worker,'installOfflineShell(self, (()=>{throw Error("never execute")})());\n');
 else await f.emit(m=>{if(kind==='version')m.version='0'.repeat(64);if(kind==='path')m.assets[0].path='../escape.js';if(kind==='duplicate')m.assets.push(m.assets[0]);if(kind==='missing')m.assets.pop();if(kind==='hash')m.assets[0].sha256='0'.repeat(64);if(kind==='base')m.base='/other/';});
 await assert.rejects(assertWriterOfflineShell(f),/Offline shell refusal/);
});
test('self-consistent runtime/manifest/version replacement still refuses original SDK runtime bytes',async t=>{
 const f=await fixture(t);await f.put('mdbase-shell-runtime.js','malicious replacement');await f.emit();
 await assert.rejects(assertWriterOfflineShell(f),/original shell runtime bytes/);
});
test('new final cache-eligible bytes cannot hide outside the inline list',async t=>{
 const f=await fixture(t);await f.put('assets/extra.js','extra final bytes');await assert.rejects(assertWriterOfflineShell(f),/ALL actual cache/);
});
