// UNPRIVILEGED installer normalization, never an original-member exception.
// No SDK/module/shim execution. Every original is proved before removal; the
// unchanged strict complete installed gate runs immediately afterwards.
import { execFileSync } from 'node:child_process';
import { lstat,readFile,readdir,realpath,unlink,rmdir } from 'node:fs/promises';
import { join,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadOriginals,originalMembers,installedMembers,protectedHashes } from './native-originals.mjs';
import { expectedYamlShim } from './pnpm-11-sh-shim.mjs';
const requireValue=(ok,reason)=>{if(!ok)throw Error('Installer refusal: '+reason);};
const version=()=>execFileSync('pnpm',['--version'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
export async function normalizeWriterInstaller({repoRoot,target,hashes,getVersion=version}) {
 requireValue(process.platform==='linux'&&getVersion()==='11.15.1','trusted pinned Linux pnpm11.15.1 required');
 repoRoot=await realpath(repoRoot);
 // Original hashes/frozen lock/SRI/facts/context/module/native metadata are
 // independently bound before looking at any installer-generated executable.
 const original=await loadOriginals({repoRoot,target,hashes});
 const roots={},inventories={},observed={};
 for(const [key,name] of Object.entries({sdk:'sdk',ui:'ui',protocol:'connect-protocol'})){
  const root=await realpath(join(repoRoot,'apps/writer/node_modules/@mdbase-dev',name));
  requireValue(relative(repoRoot,root)!==''&&!relative(repoRoot,root).startsWith('..'),'installed package outside checkout');
  roots[key]=root;inventories[key]=originalMembers(join(repoRoot,original.archives[key].path));observed[key]=await installedMembers(root);
 }
 const generated='node_modules/.bin/yaml';
 requireValue(!inventories.sdk.some(m=>m.path===generated),'generated path is an original; never remove it');
 const otherDiscrepancies=['ui','protocol'].map(key=>{const expected=new Map(inventories[key].map(m=>[m.path,m])),actual=new Map(observed[key].map(m=>[m.path,m]));return {package:key,expectedCount:expected.size,observedCount:actual.size,extras:observed[key].filter(m=>!expected.has(m.path)).map(m=>m.path).slice(0,3),changed:inventories[key].filter(m=>!isDeepStrictEqual(m,actual.get(m.path))).map(m=>m.path).slice(0,3)};});
 requireValue(isDeepStrictEqual(observed.ui,inventories.ui)&&isDeepStrictEqual(observed.protocol,inventories.protocol),'ALL UI/protocol original members '+JSON.stringify(otherDiscrepancies));
 const sdkWithoutShim=observed.sdk.filter(m=>m.path!==generated);
 const sdkOriginalPaths=new Set(inventories.sdk.map(m=>m.path)),sdkActualByPath=new Map(observed.sdk.map(m=>[m.path,m]));
 const discrepancy={expectedCount:inventories.sdk.length,observedCount:observed.sdk.length,extras:observed.sdk.filter(m=>!sdkOriginalPaths.has(m.path)).map(m=>m.path).slice(0,3),changed:inventories.sdk.filter(m=>!isDeepStrictEqual(m,sdkActualByPath.get(m.path))).map(m=>m.path).slice(0,3)};
 requireValue(isDeepStrictEqual(sdkWithoutShim,inventories.sdk),'ALL SDK original members/exact set; unrelated extra or tamper '+JSON.stringify(discrepancy));
 const shim=join(roots.sdk,generated),hasShim=observed.sdk.some(m=>m.path===generated);
 if(!hasShim){await loadOriginals({repoRoot,target,hashes,installed:true});return {normalized:false,pnpmVersion:'11.15.1',sdkMembers:inventories.sdk.length};}
 requireValue(observed.sdk.length===inventories.sdk.length+1,'only one generated non-original file');
 const stat=await lstat(shim),bin=join(shim,'..');
 requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&(stat.mode&0o777)===0o755&&stat.size<=16384&&await realpath(shim)===shim,'regular nonlink official-mode bounded shim');
 requireValue(isDeepStrictEqual(await readdir(bin),['yaml']),'no bin shadows or unrelated generated extras');
 const yaml=join(roots.sdk,'node_modules/yaml'),yamlPackage=JSON.parse(await readFile(join(yaml,'package.json'),'utf8'));
 requireValue(yamlPackage.name==='yaml'&&yamlPackage.version==='2.9.1'&&yamlPackage.bin==='./bin.mjs','original bundled YAML bin/version');
 // The ONLY accepted target is original SDK-bundled YAML, never an external
 // root/hoisted YAML shadow. Every YAML member was checked above in all SDK
 // originals; no executable or dependency from another YAML is accepted.
 const targetBin=join(yaml,'bin.mjs');
 requireValue(await realpath(targetBin)===targetBin&&(await readFile(targetBin,'utf8')).startsWith('#!/usr/bin/env node\n'),'exact original YAML target/shebang');
 const expected=Buffer.from(expectedYamlShim(targetBin,shim,repoRoot)),bytes=await readFile(shim);
 requireValue(bytes.equals(expected),'byte-for-byte official pnpm11.15.1 generateShShim template/target/node paths');
 const latest=await lstat(shim);
 requireValue(latest.ino===stat.ino&&latest.dev===stat.dev&&latest.size===stat.size&&latest.mtimeMs===stat.mtimeMs&&latest.nlink===1&&(await readFile(shim)).equals(expected),'shim changed during proof');
 await unlink(shim);await rmdir(bin); // Only proved file, then its EMPTY dir.
 await loadOriginals({repoRoot,target,hashes,installed:true});
 return {normalized:true,removedPath:generated,pnpmVersion:'11.15.1',sdkMembers:inventories.sdk.length,yamlMembers:inventories.sdk.filter(m=>m.path.startsWith('node_modules/yaml/')).length,frozenLockSha256:original.lockSha256,originalSdkSha256:original.archives.sdk.sha256};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await normalizeWriterInstaller({repoRoot:resolve('.'),target:process.env.TARGET,hashes:protectedHashes()}),null,2));}
 catch{console.error('Installer normalization refused; no candidate SDK execution');process.exitCode=1;}
}
