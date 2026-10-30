// UNPRIVILEGED bounded installer-output normalization, NEVER an original exception.
// Plan/prove BOTH allowed shims and every original BEFORE unlinking either.
import { execFileSync } from 'node:child_process';
import { lstat,readFile,readdir,realpath,readlink,unlink,rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join,relative,resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadOriginals,originalMembers,protectedHashes } from './native-originals.mjs';
import { expectedYamlShim } from './pnpm-11-sh-shim.mjs';
const requireValue=(ok,reason)=>{if(!ok)throw Error('Installer refusal: '+reason);};
const version=()=>execFileSync('pnpm',['--version'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
const hash=b=>createHash('sha256').update(b).digest('hex');
const generated='node_modules/.bin/yaml',yamlPrefix='node_modules/yaml/';
// Independently retained frozen root-lock package SRI, NOT an external YAML's claim.
const yamlSri='sha512-3NxN8+78OdzbT7C/WjGsyfPAtJaN3FNDsWxv7Y7mcDsT/oOmgW8BpyQQFFBnvZE3j9Y2Sdz1ULFLezL7Eb2yFw==';
const metadata=(path,s)=>({path,dev:s.dev,ino:s.ino,mode:s.mode,nlink:s.nlink,size:s.size,mtimeMs:s.mtimeMs});
async function snapshot(root){
 const rows=[],meta=[];let size=0,entries=0;
 async function walk(dir,prefix='',depth=0){
  requireValue(depth<=32,'inventory depth');
  for(const name of await readdir(dir)){
   requireValue(++entries<=20000,'inventory entry count');const path=join(dir,name),rel=prefix+name,s=await lstat(path);
   requireValue(!s.isSymbolicLink()&&Buffer.byteLength(rel)<=1024,'no member links/oversized paths');
   if(s.isDirectory()){meta.push(metadata(rel+'/',s));await walk(path,rel+'/',depth+1);}
   else{requireValue(s.isFile()&&s.size<=128*1024*1024&&(size+=s.size)<=512*1024*1024,'bounded regular member');const b=await readFile(path),after=await lstat(path);requireValue(b.length===s.size&&isDeepStrictEqual(metadata(rel,s),metadata(rel,after)),'member changed during read');rows.push({path:rel,bytes:b.length,sha256:hash(b)});meta.push(metadata(rel,s));}
  }
 }
 await walk(root);const cmp=(a,b)=>a.path<b.path?-1:a.path>b.path?1:0;return {rows:rows.sort(cmp),meta:meta.sort(cmp)};
}
export async function normalizeWriterInstaller({repoRoot,target,hashes,getVersion=version}) {
 requireValue(process.platform==='linux'&&getVersion()==='11.15.1','trusted pinned Linux pnpm11.15.1 required');repoRoot=await realpath(repoRoot);
 const original=await loadOriginals({repoRoot,target,hashes}),roots={},inventories={},snapshots=new Map(),plans=[];
 const capture=async root=>{requireValue(relative(repoRoot,root)!==''&&!relative(repoRoot,root).startsWith('..')&&await realpath(root)===root,'canonical installed root within checkout');const s=await snapshot(root);snapshots.set(root,s);return s.rows;};
 for(const [key,name] of Object.entries({sdk:'sdk',ui:'ui',protocol:'connect-protocol'})){
  if(!original.archives[key].path)continue; // npm UI: no archived inventory; the strict guard binds its identity.
  roots[key]=await realpath(join(repoRoot,'apps/writer/node_modules/@mdbase-dev',name));inventories[key]=originalMembers(join(repoRoot,original.archives[key].path));
  const actual=await capture(roots[key]),allowed=key==='sdk'||key==='protocol';
  requireValue(!inventories[key].some(m=>m.path===generated),'never delete an original member');
  const without=allowed?actual.filter(m=>m.path!==generated):actual;
  requireValue(isDeepStrictEqual(without,inventories[key]),'ALL '+key+' original members/exact set; no unrelated extra/tamper');
  if(allowed&&actual.some(m=>m.path===generated)){requireValue(actual.length===inventories[key].length+1,'max one generated file per allowed package');plans.push({key,shim:join(roots[key],generated)});}
 }
 const yamlMembers=inventories.sdk.filter(m=>m.path.startsWith(yamlPrefix)).map(m=>({...m,path:m.path.slice(yamlPrefix.length)}));requireValue(yamlMembers.length>0,'independently original bundled YAML');
 for(const plan of plans){
  const {key,shim}=plan,s=await lstat(shim);requireValue(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1&&(s.mode&0o777)===0o755&&s.size<=16384&&await realpath(shim)===shim,'regular bounded0755 single-link shim');
  requireValue(isDeepStrictEqual(await readdir(dirname(shim)),['yaml']),'no shim shadows/unrelated extras');
  let yaml=join(roots[key],'node_modules/yaml');
  if(!inventories[key].some(m=>m.path===yamlPrefix+'package.json')){
   requireValue(key==='protocol','only protocol may resolve external original-equal YAML');
   yaml=join(repoRoot,'node_modules/.pnpm/yaml@2.9.1/node_modules/yaml');
   const alias=join(dirname(dirname(roots.protocol)),'yaml');
   requireValue((await lstat(alias)).isSymbolicLink()&&resolve(dirname(alias),await readlink(alias))===yaml&&await realpath(alias)===yaml,'exact canonical pnpm dependency link/target, no escape/shadow');
   const lock=await readFile(join(repoRoot,'pnpm-lock.yaml'),'utf8');
   requireValue(lock.includes(`\n  yaml@2.9.1:\n    resolution: {integrity: ${yamlSri}}\n`),'independently frozen YAML version/SRI');
   const snapshotKey=`\n  '@mdbase-dev/connect-protocol@file:${original.archives.protocol.path}':\n    dependencies:\n`;
   requireValue(lock.slice(lock.lastIndexOf(snapshotKey)).split('\n\n')[0].includes('\n      yaml: 2.9.1'),'frozen direct-protocol YAML resolution');
   requireValue(isDeepStrictEqual(await capture(yaml),yamlMembers),'EVERY external YAML original member/metadata/exact set');
  }
  requireValue(await realpath(yaml)===yaml,'original YAML root without links');
  const pkg=JSON.parse(await readFile(join(yaml,'package.json'),'utf8'));
  requireValue(pkg.name==='yaml'&&pkg.version==='2.9.1'&&pkg.bin==='./bin.mjs','original YAML name/version/bin metadata');
  const targetBin=join(yaml,'bin.mjs');requireValue(await realpath(targetBin)===targetBin&&(await readFile(targetBin,'utf8')).startsWith('#!/usr/bin/env node\n'),'original regular YAML bin/shebang');
  const bytes=Buffer.from(expectedYamlShim(targetBin,shim,repoRoot));requireValue((await readFile(shim)).equals(bytes),'WHOLE official pnpm11.15.1 template/target/node paths');Object.assign(plan,{bytes,stat:metadata(generated,s)});
 }
 // All plans and ALL YAML/original proofs finish before ANY mutation. No
 // concurrent installer/candidate process may run during proof/commit.
 requireValue(isDeepStrictEqual(await loadOriginals({repoRoot,target,hashes}),original),'archive/frozen/facts changed during proof');
 for(const [root,before] of snapshots)requireValue(isDeepStrictEqual(await snapshot(root),before),'path sets/bytes/metadata changed before unlink');
 for(const p of plans)requireValue(isDeepStrictEqual(metadata(generated,await lstat(p.shim)),p.stat)&&(await readFile(p.shim)).equals(p.bytes),'shim identity/bytes changed before unlink');
 for(const p of plans){await unlink(p.shim);await rmdir(dirname(p.shim));}
 await loadOriginals({repoRoot,target,hashes,installed:true}); // UNCHANGED strict complete check, immediately after commit.
 return {normalized:plans.length>0,removed:plans.map(p=>({package:p.key,path:generated})),pnpmVersion:'11.15.1',sdkMembers:inventories.sdk.length,uiMembers:inventories.ui?.length??null,protocolMembers:inventories.protocol.length,yamlMembers:yamlMembers.length,frozenLockSha256:original.lockSha256,originalSdkSha256:original.archives.sdk.sha256};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(await normalizeWriterInstaller({repoRoot:resolve('.'),target:process.env.TARGET,hashes:protectedHashes()}),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
