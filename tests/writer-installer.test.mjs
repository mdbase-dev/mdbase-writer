import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile, chmod, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,relative,dirname } from 'node:path';
import test from 'node:test';
import { normalizeWriterInstaller } from '../scripts/lib/writer-installer.mjs';
import { loadOriginals,originalMembers } from '../scripts/lib/native-originals.mjs';
import { expectedYamlShim } from '../scripts/lib/pnpm-11-sh-shim.mjs';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'writer-installer-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const source=resolve('.'),approved=JSON.parse(await readFile(join(source,'config/native-publish/staging.json'),'utf8'));
 const paths=['apps/writer/package.json','pnpm-lock.yaml','config/native-publish/staging.json','vendor/sdk-dev-a3023aee-staging.tgz','vendor/mdbase-dev-ui-dev-9553ad66.tgz','apps/writer/vendor/mdbase-dev-connect-protocol-0.1.0-beta.129-c280cd194ffd.tgz','apps/writer/vendor/native-release/staging'];
 for(const p of paths){await mkdir(join(root,p,'..'),{recursive:true});await cp(join(source,p),join(root,p),{recursive:true});}
 await loadOriginals({target:'staging',repoRoot:root,hashes:approved.protectedHashes});
 const app=join(root,'apps/writer'),pkg=JSON.parse(await readFile(join(app,'package.json'),'utf8'));
 for(const name of ['sdk','ui','connect-protocol']){
  const archive=resolve(app,pkg.dependencies['@mdbase-dev/'+name].slice(5)),destination=join(app,'node_modules/@mdbase-dev',name);
  originalMembers(archive);await mkdir(destination,{recursive:true});execFileSync('tar',['-xzf',archive,'-C',destination,'--strip-components=1']);
 }
 const sdk=join(app,'node_modules/@mdbase-dev/sdk'),shim=join(sdk,'node_modules/.bin/yaml'),target=join(sdk,'node_modules/yaml/bin.mjs');
 await mkdir(join(shim,'..'),{recursive:true});const bytes=expectedYamlShim(target,shim,root);await writeFile(shim,bytes,{mode:0o755});
 return {root,app,sdk,shim,target,bytes,options:{target:'staging',repoRoot:root,hashes:approved.protectedHashes,getVersion:()=> '11.15.1'}};
}
test('only the exact official pnpm11 generated shim is removed after complete original proof; strict guard then passes',async t=>{
 const f=await fixture(t);await assert.rejects(loadOriginals({...f.options,installed:true}),/ALL installed original members/);
 const result=await normalizeWriterInstaller(f.options);assert.equal(result.normalized,true);assert.equal(result.sdkMembers,896);assert.ok(result.yamlMembers>100);
 await assert.rejects(lstat(f.shim),{code:'ENOENT'});await loadOriginals({...f.options,installed:true});
 const again=await normalizeWriterInstaller(f.options);assert.equal(again.normalized,false);await loadOriginals({...f.options,installed:true});
});
async function protocolFixture(t){
 const f=await fixture(t),protocol=join(f.app,'node_modules/@mdbase-dev/connect-protocol');
 const yaml=join(f.root,'node_modules/.pnpm/yaml@2.9.1/node_modules/yaml');await mkdir(dirname(yaml),{recursive:true});await cp(join(f.sdk,'node_modules/yaml'),yaml,{recursive:true});
 const alias=join(f.app,'node_modules/yaml');await symlink(relative(dirname(alias),yaml),alias);
 const protocolShim=join(protocol,'node_modules/.bin/yaml');await mkdir(dirname(protocolShim),{recursive:true});const protocolBytes=expectedYamlShim(join(yaml,'bin.mjs'),protocolShim,f.root);await writeFile(protocolShim,protocolBytes,{mode:0o755});
 return {...f,protocol,yaml,alias,protocolShim,protocolBytes};
}
test('SDK plus direct-protocol official shims are BOTH planned/proved before either removal',async t=>{
 const f=await protocolFixture(t);const result=await normalizeWriterInstaller(f.options);assert.equal(result.removed.length,2);await assert.rejects(lstat(f.shim),{code:'ENOENT'});await assert.rejects(lstat(f.protocolShim),{code:'ENOENT'});await loadOriginals({...f.options,installed:true});
});
for(const kind of ['template','append-exec','target','version','external-byte','external-metadata','external-extra','external-missing','external-link','shim-link','shadow','extra','sri','alias'])test('protocol '+kind+' refuses with BOTH shims untouched',async t=>{
 const f=await protocolFixture(t);
 if(kind==='template')await writeFile(f.protocolShim,'#!/bin/sh\nexit 0\n');
 if(kind==='append-exec')await writeFile(f.protocolShim,f.protocolBytes+'echo never-execute\n');
 if(kind==='target')await writeFile(f.protocolShim,expectedYamlShim(f.target,f.protocolShim,f.root));
 if(kind==='version')f.options.getVersion=()=> '10.7.0';
 if(kind==='external-byte')await writeFile(join(f.yaml,'dist/index.js'),'tampered');
 if(kind==='external-metadata')await writeFile(join(f.yaml,'package.json'),'{}');
 if(kind==='external-extra')await writeFile(join(f.yaml,'extra.js'),'extra');
 if(kind==='external-missing')await rm(join(f.yaml,'LICENSE'));
 if(kind==='external-link'){await rm(join(f.yaml,'LICENSE'));await symlink(join(f.yaml,'package.json'),join(f.yaml,'LICENSE'));}
 if(kind==='shim-link'){await rm(f.protocolShim);await symlink(f.target,f.protocolShim);}
 if(kind==='shadow')await mkdir(join(f.protocolShim,'../node'));
 if(kind==='extra')await writeFile(join(f.protocol,'extra.js'),'extra');
 if(kind==='sri'){const p=join(f.root,'pnpm-lock.yaml');await writeFile(p,(await readFile(p,'utf8')).replace('sha512-3NxN8','sha512-xxxxx'));}
 if(kind==='alias'){await rm(f.alias);await symlink(join(f.sdk,'node_modules/yaml'),f.alias);}
 const before=await Promise.all([readFile(f.shim),readFile(f.protocolShim)]);await assert.rejects(normalizeWriterInstaller(f.options));assert.deepEqual(await readFile(f.shim),before[0]);assert.deepEqual(await readFile(f.protocolShim),before[1]);
});
for(const kind of ['wrong-shim','appended-exec','target','pnpm-version','original-tamper','yaml-tamper','ui-tamper','link','unrelated-extra','shadow','mode','metadata-tamper','frozen-sri','archive-hash'])test(kind+' refuses BEFORE removal, never executes shim/SDK',async t=>{
 const f=await fixture(t);
 if(kind==='wrong-shim')await writeFile(f.shim,'#!/bin/sh\nexit 0\n');
 if(kind==='appended-exec')await writeFile(f.shim,f.bytes+'echo do-not-execute\n');
 if(kind==='target')await writeFile(f.shim,expectedYamlShim(join(f.sdk,'node_modules/yaml/dist/cli.mjs'),f.shim,f.root));
 if(kind==='pnpm-version')f.options.getVersion=()=> '10.7.0';
 if(kind==='original-tamper')await writeFile(join(f.sdk,'dist/application/packaged-trust.js'),'tampered original');
 if(kind==='yaml-tamper')await writeFile(join(f.sdk,'node_modules/yaml/dist/index.js'),'tampered YAML');
 if(kind==='ui-tamper')await writeFile(join(f.app,'node_modules/@mdbase-dev/ui/package.json'),'{}');
 if(kind==='link'){await rm(f.shim);await symlink(f.target,f.shim);}
 if(kind==='unrelated-extra')await writeFile(join(f.sdk,'non-original.js'),'do not execute');
 if(kind==='shadow')await mkdir(join(f.shim,'../node'));
 if(kind==='mode')await chmod(f.shim,0o644);
 if(kind==='metadata-tamper')await writeFile(join(f.sdk,'package.json'),'{}');
 if(kind==='frozen-sri'){const lock=join(f.root,'pnpm-lock.yaml');await writeFile(lock,(await readFile(lock,'utf8')).replace('sha512-qfff','sha512-xxxx'));}
 if(kind==='archive-hash')await writeFile(join(f.root,'vendor/sdk-dev-a3023aee-staging.tgz'),'not the approved original');
 const prior=await readFile(f.shim),link=(await lstat(f.shim)).isSymbolicLink();
 await assert.rejects(normalizeWriterInstaller(f.options));
 assert.deepEqual(await readFile(f.shim),prior);assert.equal((await lstat(f.shim)).isSymbolicLink(),link);
});
