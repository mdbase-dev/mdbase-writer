// Static BYTE evidence and distinct hosting/runtime policy evidence. No auth bypass,
// R2 writes, rebuilds, rollback, or literal GET of executing Worker source.
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyServedBytes, assertInventory } from '../../../scripts/lib/native-publish-bytes.mjs';
import { assertRuntimeOriginals } from '../../../scripts/lib/writer-runtime-originals.mjs';
import { sourceHostingPolicy, assertHostingMetadata, coveredHostingControls } from '../../../scripts/lib/writer-hosting-policy.mjs';
import { assertInventoryCoverage } from './native-publisher.mjs';
export const isFetchableAsset=path=>!['_routes.json','_headers','_redirects'].includes(path.split('/').at(-1))&&path!=='_worker.js'&&!path.startsWith('_worker.js/');
export function servedUrlFor(origin,path){return origin+'/'+(path==='index.html'?'':path.endsWith('.html')?path.slice(0,-5):path);}
async function probe(transport,url,headers,expectedStatus,expectedBody,remaining) {
 if(remaining<=0)throw Error('publication-timeout');
 const controller=new AbortController();let timer,response,reader;
 try {
  return await Promise.race([ (async()=>{
   response=await transport(url,{method:'GET',redirect:'manual',credentials:'omit',cache:'no-store',headers,signal:controller.signal});
   if(response.redirected||(response.url&&response.url!==url)||response.status!==expectedStatus)throw Error('route/status/redirect');
   reader=response.body?.getReader();let length=0;const chunks=[];
   if(reader)try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>64)throw Error('probe-body-limit');chunks.push(value);}}finally{Promise.resolve(reader.cancel()).catch(()=>{});}
   if(Buffer.concat(chunks).toString()!==expectedBody)throw Error('route-body');
   return response;
  })(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('probe-timeout'));},Math.min(10000,remaining));})]);
 } finally {clearTimeout(timer);controller.abort();try{Promise.resolve(reader?reader.cancel():response?.body?.cancel()).catch(()=>{});}catch{}}

}
export async function verifyServedAssets({origin,inventory,publication, ...options}) {
 if(!['https://staging.mdbase-writer.pages.dev','https://writer.mdbase.dev'].includes(origin))throw Error('Refusing non-target verification origin');
 assertInventoryCoverage(inventory);
 const worker=inventory.filter(a=>a.path==='_worker.js'||a.path.startsWith('_worker.js/'));
 const staticInventory=inventory.filter(a=>!worker.includes(a));
 const urlMapping=Object.fromEntries(staticInventory.filter(a=>a.path.endsWith('.html')&&a.path!=='index.html').map(a=>[a.path,servedUrlFor(origin,a.path)]));
 let policy,metadataEvidence=null,runtime=[],coveredControls=[],policyFailures=[];
 try {
  if(!publication)throw Error('missing trusted source/runtime/deployment inputs');
  const {repoRoot,artifactRoot,plan,deployment,metadata,preflight}=publication;
  if(plan.origin!==origin)throw Error('source target origin');
  policy=await sourceHostingPolicy(repoRoot);
  assertHostingMetadata(policy,metadata,plan,deployment,preflight);
  metadataEvidence={project:{id:metadata.project.id,name:metadata.project.name,production_branch:metadata.project.production_branch},configuration:{compatibility_date:metadata.configuration.compatibility_date,compatibility_flags:[],r2_buckets:{WRITER_ASSETS:{name:metadata.configuration.r2_buckets.WRITER_ASSETS.name}}},deployment:{id:metadata.deployment.id,url:metadata.deployment.url,environment:metadata.deployment.environment,sourceSha:metadata.deployment.sourceSha,pagesBranch:metadata.deployment.pagesBranch}};
  await assertInventory(join(artifactRoot,'publish'),inventory);
  coveredControls=coveredHostingControls(policy,inventory);
  runtime=await assertRuntimeOriginals(repoRoot,artifactRoot);
  if(runtime.some(r=>inventory.some(a=>a.path===r.path)))throw Error('static/runtime route collision');
 }catch{policyFailures.push({reason:'trusted-source-runtime-deployment-policy-refused'});coveredControls=[];runtime=[];}
 const transport=options.fetch??fetch,etags=new Map(),headerFailures=[];
 const runtimeNames=new Map(runtime.map(r=>[r.path,r]));
 const start=performance.now(),total=options.totalTimeoutMs??180000;
 const left=()=>Math.max(0,total-(performance.now()-start));
 const fetchWithPolicy=async(url,init)=>{
  const response=await transport(url,init),path=new URL(url).pathname.slice(1),expected=runtimeNames.get(path);
  if(expected&&response.status===200){
   const headers=response.headers;
   const good=headers?.get('content-type')==='application/wasm'&&headers.get('content-length')===String(expected.bytes)&&headers.get('cache-control')==='public, max-age=31536000, immutable'&&/^"[\x21\x23-\x7e]+"$/.test(headers.get('etag')??'');
   if(!good){headerFailures.push({path,reason:'runtime-content-type-length-cache-etag'});try{Promise.resolve(response.body?.cancel()).catch(()=>{});}catch{}throw Error('runtime headers');}
   etags.set(path,headers.get('etag'));
  }
  return response;
 };
 const result=await verifyServedBytes(origin,[...staticInventory,...runtime],{...options,fetch:fetchWithPolicy,urlMapping});
 const runtimeVerified=result.verified.filter(r=>runtimeNames.has(r.path));
 result.verified=result.verified.filter(r=>!runtimeNames.has(r.path));
 result.unverified.push(...worker.map(a=>({...a,reason:'executing-worker-requires-trusted-runtime-policy-check'})));
 const behavior=[];
 if(runtime.length===2&&result.failures.length===0&&headerFailures.length===0){
  const probes=[...runtime.map(r=>({path:r.path,headers:{'If-None-Match':etags.get(r.path)},status:304,body:'',etag:etags.get(r.path)})),{path:'wasm/native-publisher-invalid.txt',status:404,body:'Not found'},{path:`wasm/native-publisher-missing-${publication.plan.sha}.wasm`,status:404,body:'Not found'}];
  for(const p of probes)try{
   const response=await probe(transport,origin+'/'+p.path,p.headers,p.status,p.body,left());
   if(p.etag&&response.headers.get('etag')!==p.etag)throw Error('conditional-etag');
   if(left()<=0)throw Error('publication-timeout');
   behavior.push({path:p.path,status:p.status,check:p.etag?'conditional-etag-empty-304':'invalid-or-missing-404-body'});
  }catch{policyFailures.push({path:p.path,reason:'runtime-route-conditional-behavior-refused'});}
 }
 if(runtimeVerified.length!==2||behavior.length!==4||headerFailures.length||result.failures.length)coveredControls=[];
 const covered=new Set(coveredControls.map(r=>r.path));
 result.unverified=result.unverified.filter(r=>!covered.has(r.path));
 const policyEvidence={sourceConfigSha256:policy?.sourceConfigSha256??null,metadata:metadataEvidence,coveredControls,behavior};
 const ok=policyFailures.length===0&&headerFailures.length===0&&result.failures.length===0&&result.unverified.length===0&&runtimeVerified.length===2&&behavior.length===4&&result.verified.length+coveredControls.length===inventory.length;
 return {...result,ok,runtimeVerified,policyFailures:[...policyFailures,...headerFailures],policyEvidence};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,v,i,a)=>i%2?pairs:[...pairs,[v.slice(2),a[i+1]]],[]));
 try{
  const json=async path=>JSON.parse(await readFile(path,'utf8'));
  const publication=args.artifact?{repoRoot:resolve('.'),artifactRoot:resolve(args.artifact),plan:await json(args.plan),deployment:await json(args.deployment),metadata:await json(args.metadata),preflight:await json(args.preflight)}:undefined;
  const result=await verifyServedAssets({origin:args.origin,inventory:await json(args.inventory),publication});
  console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
 }catch{console.log(JSON.stringify({ok:false,error:'source runtime/metadata/byte verification unavailable'}));process.exitCode=1;}
}
