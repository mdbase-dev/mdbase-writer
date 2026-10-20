// Official ORIGINAL npm DATA only. No install, package execution, repack or R2 write.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { originalMembers } from './native-originals.mjs';
const definitions=[
 {name:'@myriaddreamin/typst-ts-web-compiler',basename:'typst-ts-web-compiler',archive:'runtime-originals/typst.tgz',member:'pkg/typst_ts_web_compiler_bg.wasm',prefix:'typst_ts_web_compiler-'},
 {name:'pandoc-wasm',basename:'pandoc-wasm',archive:'runtime-originals/pandoc.tgz',member:'src/pandoc.wasm',prefix:'pandoc-'},
];
const hash=(b,algorithm='sha256')=>createHash(algorithm).update(b).digest(algorithm==='sha512'?'base64':'hex');
const check=(ok,reason)=>{if(!ok)throw Error('Runtime original refusal: '+reason);};
export async function runtimeSourcePins(repoRoot) {
 const pkg=JSON.parse(await readFile(join(repoRoot,'apps/writer/package.json'),'utf8'));
 const lock=await readFile(join(repoRoot,'pnpm-lock.yaml'),'utf8');
 const importer=lock.split('\n  apps/writer:\n')[1]?.split(/\n  [^ ]/)[0];
 return definitions.map(d=>{
  const version=pkg.dependencies?.[d.name];check(/^\d+\.\d+\.\d+$/.test(version??''),'exact original version required');
  const quoted=d.name.startsWith('@')?`'${d.name}'`:d.name;
  check(importer?.includes(`      ${quoted}:\n        specifier: ${version}\n        version: ${version}\n`),'frozen importer pin');
  const key=d.name.startsWith('@')?`'${d.name}@${version}'`:`${d.name}@${version}`;
  const record=lock.split(`\n  ${key}:\n    resolution: {integrity: `)[1]?.split('}')[0];
  check(/^sha512-[A-Za-z0-9+/]{86}==$/.test(record??''),'independent root lock SHA512 integrity');
  return {...d,version,sri:record,url:`https://registry.npmjs.org/${d.name}/-/${d.basename}-${version}.tgz`};
 });
}
async function originalFile(root,path) {
 const full=join(root,path);check((await lstat(full)).isFile()&&await realpath(full)===full,'regular original, no symlinks');
 const bytes=await readFile(full);check(bytes.length<=128*1024*1024,'archive limit');return bytes;
}
export async function deriveRuntimeOriginals(repoRoot,artifactRoot) {
 const pins=await runtimeSourcePins(repoRoot),out=[];
 for(const d of pins) {
  const bytes=await originalFile(artifactRoot,d.archive);
  check(`sha512-${hash(bytes,'sha512')}`===d.sri,`${d.name} original SRI`);
  const archive=join(artifactRoot,d.archive),members=originalMembers(archive);
  const wasm=members.find(m=>m.path===d.member),pkg=members.find(m=>m.path==='package.json');
  check(wasm&&pkg&&wasm.bytes>0&&wasm.bytes<=128*1024*1024,'exact official WASM member');
  const packageBytes=execFileSync('tar',['-xOzf',archive,'package/package.json'],{maxBuffer:1024*1024});
  const identity=JSON.parse(packageBytes);check(identity.name===d.name&&identity.version===d.version,'original package identity');
  out.push({name:d.name,version:d.version,archive:d.archive,sri:d.sri,archiveSha256:hash(bytes),member:'package/'+d.member,path:'wasm/'+d.prefix+d.version+'.wasm',bytes:wasm.bytes,sha256:wasm.sha256});
 }
 return out;
}
export async function assertRuntimeOriginals(repoRoot,artifactRoot) {
 const expected=await deriveRuntimeOriginals(repoRoot,artifactRoot);
 const supplied=JSON.parse(await originalFile(artifactRoot,'runtime.json'));
 check(isDeepStrictEqual(supplied,expected),'artifact runtime expectations differ from trusted source lock/originals');
 return expected;
}
export async function prepareRuntimeOriginals(repoRoot,artifactRoot,transport=fetch) {
 const pins=await runtimeSourcePins(repoRoot);await mkdir(join(artifactRoot,'runtime-originals'),{recursive:true});
 for(const pin of pins) {
  const response=await transport(pin.url,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(60000)});
  check(response.status===200,'official npm archive HTTP status');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;check(size<=128*1024*1024,'archive byte bound');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);check('sha512-'+hash(bytes,'sha512')===pin.sri,'official npm original SHA512');
  await writeFile(join(artifactRoot,pin.archive),bytes,{flag:'wx'});
 }
 const expected=await deriveRuntimeOriginals(repoRoot,artifactRoot);
 await writeFile(join(artifactRoot,'runtime.json'),JSON.stringify(expected,null,2),{flag:'wx'});
 return expected;
}
