import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inventoryDirectory } from '../scripts/lib/native-publish-bytes.mjs';
export const hash=(b,alg='sha256')=>createHash(alg).update(b).digest(alg==='sha512'?'base64':'hex');
export async function hostingFixture(t) {
 const repoRoot=await mkdtemp(join(tmpdir(),'writer-hosting-'));t.after(()=>rm(repoRoot,{recursive:true,force:true}));
 const artifactRoot=join(repoRoot,'artifact'),publish=join(artifactRoot,'publish');
 const put=async(path,bytes)=>{await mkdir(join(path,'..'),{recursive:true});await writeFile(path,bytes);};
 for(const path of ['wrangler.jsonc','public/_routes.json']) await put(join(repoRoot,'apps/writer',path),await readFile(new URL('../apps/writer/'+path,import.meta.url)));
 const definitions=[{name:'@myriaddreamin/typst-ts-web-compiler',version:'0.7.0',file:'typst.tgz',member:'pkg/typst_ts_web_compiler_bg.wasm',path:'wasm/typst_ts_web_compiler-0.7.0.wasm'}, {name:'pandoc-wasm',version:'1.1.0',file:'pandoc.tgz',member:'src/pandoc.wasm',path:'wasm/pandoc-1.1.0.wasm'}];
 let importer='',resolutions='';const runtime=[];const data={};
 for(const d of definitions) {
  const source=join(repoRoot,'originals',d.file,'package'),bytes=Buffer.from('\0asm'+d.name);
  await put(join(source,'package.json'),JSON.stringify({name:d.name,version:d.version}));await put(join(source,d.member),bytes);
  const archive=join(artifactRoot,'runtime-originals',d.file);await mkdir(join(archive,'..'),{recursive:true});execFileSync('tar',['-czf',archive,'-C',join(source,'..'),'package']);
  const tgz=await readFile(archive),sri='sha512-'+hash(tgz,'sha512');
  const quoted=d.name.startsWith('@')?`'${d.name}'`:d.name;
  importer+=`      ${quoted}:\n        specifier: ${d.version}\n        version: ${d.version}\n`;
  const key=d.name.startsWith('@')?`'${d.name}@${d.version}'`:`${d.name}@${d.version}`;
  resolutions+=`  ${key}:\n    resolution: {integrity: ${sri}}\n`;
  runtime.push({name:d.name,version:d.version,archive:'runtime-originals/'+d.file,sri,archiveSha256:hash(tgz),member:'package/'+d.member,path:d.path,bytes:bytes.length,sha256:hash(bytes)});data[d.path]=bytes;
 }
 await put(join(repoRoot,'apps/writer/package.json'),JSON.stringify({dependencies:Object.fromEntries(definitions.map(d=>[d.name,d.version]))}));
 await put(join(repoRoot,'pnpm-lock.yaml'),`lockfileVersion: '9.0'\nimporters:\n  apps/writer:\n    dependencies:\n${importer}\npackages:\n${resolutions}`);
 for(const [name,bytes] of Object.entries({'index.html':'writer','.well-known/mdbase-app.json':'{}','assets/app.js':'export {};','assets/sdk.wasm':'\0asm','_worker.js':'compiled fixture Worker'})) await put(join(publish,name),bytes);
 await put(join(publish,'_routes.json'),await readFile(join(repoRoot,'apps/writer/public/_routes.json')));
 await put(join(artifactRoot,'runtime.json'),JSON.stringify(runtime,null,2));
 const inventory=await inventoryDirectory(publish);
 for(const row of inventory) data[row.path]=await readFile(join(publish,row.path));
 const source='a'.repeat(40),id='12345678-1234-1234-1234-123456789abc';
 const metadata={project:{id:'project-fixture-id',name:'mdbase-writer',production_branch:'main'},configuration:{compatibility_date:'2026-09-27',compatibility_flags:[],r2_buckets:{WRITER_ASSETS:{name:'mdbase-writer-assets'}}},deployment:{id,url:'https://abcdef12.mdbase-writer.pages.dev',environment:'preview',sourceSha:source,pagesBranch:'staging'}};
 const plan={sha:source,tree:'b'.repeat(40),pagesBranch:'staging',origin:'https://staging.mdbase-writer.pages.dev',sdkTrust:{environment:'staging'}};
 const deployment={id,url:metadata.deployment.url,sourceSha:source,pagesBranch:'staging'};
 const etag='"original-etag"';
 const fetch=async(url,options={})=>{
  const path=new URL(url).pathname.slice(1)||'index.html';
  if(path==='wasm/native-publisher-invalid.txt'||path.startsWith('wasm/native-publisher-missing-')) return new Response('Not found',{status:404});
  if(Object.hasOwn(data,path)) {
   const bytes=data[path],isRuntime=runtime.some(r=>r.path===path);
   if(isRuntime&&new Headers(options.headers).get('if-none-match')===etag) return new Response(null,{status:304,headers:{ETag:etag}});
   return new Response(bytes,{headers:isRuntime?{'Content-Type':'application/wasm','Content-Length':String(bytes.length),'Cache-Control':'public, max-age=31536000, immutable',ETag:etag}:{}});
  }
  return new Response('Not found',{status:404});
 };
 return {repoRoot,artifactRoot,publish,inventory,runtime,data,metadata,plan,deployment,fetch,put,publication:{repoRoot,artifactRoot,plan,deployment,metadata}};
}
