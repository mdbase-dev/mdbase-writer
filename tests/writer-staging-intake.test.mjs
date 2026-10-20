import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { loadOriginals } from '../scripts/lib/native-originals.mjs';
import { normalizeWriterInstaller } from '../scripts/lib/writer-installer.mjs';
import { trustFixture } from './native-originals-fixture.mjs';
test('CI and local qualification use the bounded normalizer before unchanged strict guards/candidate code',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/deploy-writer.yml',import.meta.url),'utf8');
 const build=workflow.split('  native-build:')[1].split('  native-deploy:')[0];
 assert.ok(build.indexOf('node scripts/lib/writer-installer.mjs')<build.indexOf('> "$RUNNER_TEMP/installed-plan.json"'));assert.ok(build.indexOf('> "$RUNNER_TEMP/installed-plan.json"')<build.indexOf('pnpm rebuild --pending'));
 assert.doesNotMatch(workflow.split('  native-deploy:')[1],/writer-installer|pnpm rebuild/);
 const runnerUrl=new URL('../scripts/qualify-native-staging.mjs',import.meta.url);
 execFileSync(process.execPath,['--check',fileURLToPath(runnerUrl)]); // Parse only; NEVER starts a held build.
 const runner=await readFile(runnerUrl,'utf8');
 assert.ok(runner.indexOf('await normalizeWriterInstaller(options)')<runner.indexOf('await import(pathToFileURL'));assert.ok(runner.indexOf('installed:true')<runner.indexOf('await import(pathToFileURL'));
 assert.doesNotMatch(runner,/GITHUB_REF\s*[:=]|ALLOW_DIRTY|assertExactCleanCheckout\s*=|offline-assets\.json/);
 const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));assert.equal(pkg.packageManager,'pnpm@11.15.1');
});
for(const field of ['factsSha256','sdkSource','sdkTree'])test('independent source input '+field+' cannot be replaced by candidate metadata',async t=>{
 const f=await trustFixture('staging');t.after(()=>rm(f.repo,{recursive:true,force:true}));
 const path=join(f.repo,'config/native-publish/staging.json'),value=JSON.parse(await readFile(path,'utf8'));
 value[field]='0'.repeat(field==='factsSha256'?64:40);await writeFile(path,JSON.stringify(value));
 await assert.rejects(loadOriginals({target:'staging',repoRoot:f.repo,hashes:f.hashes,installed:true}),/approved facts|approved SDK/);
});
test('candidate replaces facts SDK source but cannot change independently pinned facts digest',async t=>{
 const f=await trustFixture('staging');t.after(()=>rm(f.repo,{recursive:true,force:true}));
 const path=join(f.packet,'artifact-facts.json'),value=JSON.parse(await readFile(path,'utf8'));value.source='d'.repeat(40);await writeFile(path,JSON.stringify(value));
 await assert.rejects(loadOriginals({target:'staging',repoRoot:f.repo,hashes:f.hashes,installed:true}),/approved facts/);
});
test('producer inventory order is not authority, EVERY complete member still binds',async t=>{
 const f=await trustFixture('staging');t.after(()=>rm(f.repo,{recursive:true,force:true}));
 const path=join(f.packet,'members.json'),value=JSON.parse(await readFile(path,'utf8'));await writeFile(path,JSON.stringify(value.reverse()));
 await loadOriginals({target:'staging',repoRoot:f.repo,hashes:f.hashes,installed:true});
 value.push(value[0]);await writeFile(path,JSON.stringify(value));
 await assert.rejects(loadOriginals({target:'staging',repoRoot:f.repo,hashes:f.hashes,installed:true}),/complete SDK inventory/);
});
test('actual eaa4 Writer-approved packet and ALL installed SDK/UI9553/C280 members bind before candidate SDK execution',async()=>{
 const repoRoot=resolve('.'),approved=JSON.parse(await readFile(join(repoRoot,'config/native-publish/staging.json'),'utf8'));
 assert.equal(approved.factsSha256,'d54aef71521ab3561bd9a81cd1303410a3fde29f8fbd35a1e0041e58d0569de3');
 assert.equal(approved.protectedHashes.NATIVE_UI_SHA256,'5e388db28365cf6a966017851ece1c32223ea8b55bc6015d2f1b4113d86a3206');
 const installer=await normalizeWriterInstaller({target:'staging',repoRoot,hashes:approved.protectedHashes});console.log(JSON.stringify({actualInstallerEvidence:installer}));
 const result=await loadOriginals({target:'staging',repoRoot,hashes:approved.protectedHashes,installed:true});
 assert.equal(result.archives.sdk.sha256,'15eb64b50fc7c2809ff3dba9cce5104fe48d8592208b3af8acb529862a1af18c');assert.equal(result.archives.sdk.bytes,4461608);assert.equal(result.archives.sdk.members,896);
 assert.equal(result.release.environment,'staging');assert.equal(result.release.cpOrigin,'https://connect-staging.mdbase.dev');assert.equal(result.release.logOrigin,'https://log-staging.mdbase.dev');assert.equal(result.release.assetSha256,'67e117646c9c26927f0d5a44cbd26f057c318975032e9cd24f24b020150cdbc7');
 assert.equal(result.release.source.commit,'f45df4598a5bff891de68eec3431ec7744885067');assert.equal(result.release.source.version,'0.1.0-beta.134');
 assert.equal(result.nativeAssets['runtime.wasm'].bytes,3676583);assert.equal(result.nativeAssets['runtime.wasm'].sha256,'6984f87d98e29d9f99c6b07f7728f716d1f7b2e3585a74bcc2046ba259a8afab');
 assert.equal(result.nativeAssets['sqlite3.wasm'].sha256,'2ee8f3dab694532afc8840e07703127287662d08b74e6ff50491ce63f00d5752');assert.equal(result.nativeAssets['sqlite3.js'].sha256,'a6d3fe46aa3f924e7686329f97b0564549ef1f787e0c19924179aef7f72bcc01');
});
