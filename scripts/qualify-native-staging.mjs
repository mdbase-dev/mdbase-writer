// Explicit finite LOCAL/remote-builder qualification, NOT dispatch/publication.
// rpnpm sends neither .git nor environment: approved public source DATA supplies
// exact original expectations. Never forge GitHub refs/clean tree/source SHA.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp,mkdir,mkdtemp,readFile,rm,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeWriterInstaller } from './lib/writer-installer.mjs';
import { loadOriginals } from './lib/native-originals.mjs';
import { assertCompiledRelease } from './lib/writer-compiled-trust.mjs';
import { assertWriterOfflineShell } from './lib/writer-offline-shell.mjs';
import { sourceHostingPolicy,uploadConfiguration,coveredHostingControls } from './lib/writer-hosting-policy.mjs';
import { assertBuiltTarget,assertInventoryCoverage,buildAssetInventory } from '../apps/writer/scripts/native-publisher.mjs';
const repo=resolve('.'),mode=process.argv[2];
if(!['originals','check','build','verify'].includes(mode))throw Error('Explicit originals/check/build/verify source qualification mode required');
if(process.env.CLOUDFLARE_API_TOKEN||process.env.CLOUDFLARE_TOKEN||process.env.CLOUDFLARE_ACCOUNT_ID)throw Error('Unprivileged qualification must not receive Cloudflare credentials');
const approved=JSON.parse(await readFile(join(repo,'config/native-publish/staging.json'),'utf8'));
const options={repoRoot:repo,target:'staging',hashes:approved.protectedHashes};
const installer=await normalizeWriterInstaller(options);
const sdkTrust=await loadOriginals({...options,installed:true});
const evidence={kind:'UNPRIVILEGED-source-qualification-NOT-publication-or-native-admission',sourceSha:null,sourceTree:null,qualificationOnly:true,publication:false,admission:false,installer,sdkTrust};
// NO candidate SDK code before ALL original/frozen/installed complete proofs.
if(mode==='originals'){console.log(JSON.stringify(evidence,null,2));process.exit(0);}
const {appReleaseTrust}=await import(pathToFileURL(join(repo,'apps/writer/node_modules/@mdbase-dev/sdk/dist/application/packaged-trust.js')).href);
evidence.compiledTrust=assertCompiledRelease({compiled:appReleaseTrust(),moduleBytes:await readFile(join(repo,'apps/writer/node_modules/@mdbase-dev/sdk/dist/application/packaged-trust.js')),sdkTrust});
const env={...process.env,MDBASE_ENV:'staging',VITE_MDBASE_ENV:'staging',MDBASE_WRITER_ORIGIN:sdkTrust.appOrigin,MDBASE_WRITER_BASE_PATH:'/',VITE_MDBASE_CONNECT_URL:sdkTrust.connectOrigin,VITE_MDBASE_CONNECT_LOOPBACK_URL:'',VITE_MDBASE_EDITOR_URL:sdkTrust.editorOrigin,VITE_WRITER_DEMO:'0',VITE_MDBASE_WRITER_BUILD_ID:'source-qualification-staging',WRANGLER_SEND_METRICS:'false',NPM_CONFIG_USERCONFIG:'/dev/null',NPM_CONFIG_GLOBALCONFIG:'/dev/null'};
const run=(cmd,args,cwd=repo)=>execFileSync(cmd,args,{cwd,env,stdio:'inherit'});
if(mode==='check'){run('pnpm',['check']);console.log(JSON.stringify(evidence,null,2));process.exit(0);}
const generated=['apps/writer/public/.well-known/mdbase-app.json','apps/writer/src/generated/mdbase-app.json'];
const previous=await Promise.all(generated.map(p=>readFile(join(repo,p)).catch(error=>{if(error.code==='ENOENT')return null;throw error;})));
let tools;
try{
 const dist=join(repo,'apps/writer/dist');
 if(mode==='build'){
  run('pnpm',['--filter','@mdbase-writer/app','build']); // ONE actual app build
  tools=await mkdtemp(join(repo,'.publisher-tools-'));
  for(const file of ['package.json','pnpm-lock.yaml'])await cp(join(repo,'tools/native-publisher',file),join(tools,file));
  run('pnpm',['--ignore-workspace','install','--frozen-lockfile','--ignore-scripts','--ignore-pnpmfile'],tools);
  assert.equal(JSON.parse(await readFile(join(tools,'node_modules/wrangler/package.json'))).version,'4.114.0');
  await writeFile(join(tools,'wrangler.json'),JSON.stringify(uploadConfiguration(await sourceHostingPolicy(repo))));
  run(join(tools,'node_modules/.bin/wrangler'),['pages','functions','build',join(repo,'apps/writer/functions'),'--outfile',join(dist,'_worker.js')],tools);
 }
 // verify mode is POST-ONLY: never app rebuild or Functions recompilation.
 run('node',['apps/writer/scripts/validate-manifest.mjs',join(dist,'.well-known/mdbase-app.json')]);
 assertBuiltTarget({target:'staging',manifest:JSON.parse(await readFile(join(dist,'.well-known/mdbase-app.json'))),routes:JSON.parse(await readFile(join(dist,'_routes.json')))});
 const inventory=await buildAssetInventory(dist);assertInventoryCoverage(inventory,sdkTrust);
 const offlineShell=await assertWriterOfflineShell({directory:dist,repoRoot:repo,sdkTrust});
 assert.deepEqual(offlineShell.inventory.map(({path,bytes,sha256})=>({path,bytes,sha256})),inventory.map(({path,bytes,sha256})=>({path,bytes,sha256})));
 coveredHostingControls(await sourceHostingPolicy(repo),inventory);
 const js=await Promise.all(inventory.filter(a=>/\.m?js$/.test(a.path)&&a.path!=='_worker.js').map(a=>readFile(join(dist,a.path),'utf8')));
 for(const literal of [sdkTrust.release.cpOrigin,sdkTrust.release.logOrigin,sdkTrust.release.assetSha256,sdkTrust.release.source.commit,sdkTrust.editorOrigin])assert.ok(js.some(s=>s.includes(literal)),'missing exact compiled staging trust/Editor binding');
 await mkdir(join(repo,'test-results'),{recursive:true});
 await writeFile(join(repo,'test-results/writer-staging-qualification.json'),JSON.stringify({...evidence,mode,offlineShell,inventory},null,2));
 console.log(JSON.stringify({...evidence,mode,fullInventoryFiles:inventory.length,offlineShell:{worker:offlineShell.worker,cacheAssets:offlineShell.cacheAssets,version:offlineShell.version,originalRuntime:offlineShell.originalRuntime}},null,2));
}finally{
 if(tools)await rm(tools,{recursive:true,force:true});
 for(let i=0;i<generated.length;i++){const path=join(repo,generated[i]);if(previous[i]===null)await rm(path,{force:true});else await writeFile(path,previous[i]);}
}
