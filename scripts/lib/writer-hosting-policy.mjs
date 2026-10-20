// Trusted SOURCE policy and safe API projections. Never persist env_vars/secrets.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { writerDeployments } from '../../apps/writer/scripts/deployment-environment.mjs';
const check=(ok,reason)=>{if(!ok)throw Error('Hosting policy refusal: '+reason);};
export const digest=b=>createHash('sha256').update(b).digest('hex');
export async function sourceHostingPolicy(repoRoot) {
 const bytes=await readFile(join(repoRoot,'apps/writer/wrangler.jsonc'));
 // Source's existing JSONC uses whole-line comments only. Unknown syntax refuses.
 const source=JSON.parse(bytes.toString().replace(/^\s*\/\/.*$/gm,''));
 check(Object.keys(source).sort().join(',')==='compatibility_date,name,pages_build_output_dir,r2_buckets','unknown source deployment settings');
 check(source.name==='mdbase-writer'&&source.pages_build_output_dir==='./dist'&&/^\d{4}-\d{2}-\d{2}$/.test(source.compatibility_date),'source project/date/output');
 check(source.r2_buckets?.length===1&&source.r2_buckets[0].binding==='WRITER_ASSETS'&&source.r2_buckets[0].bucket_name==='mdbase-writer-assets'&&Object.keys(source.r2_buckets[0]).sort().join(',')==='binding,bucket_name','source R2 binding');
 const routesBytes=await readFile(join(repoRoot,'apps/writer/public/_routes.json'));
 check(isDeepStrictEqual(JSON.parse(routesBytes),{version:1,include:['/wasm/*'],exclude:[]}), 'source routes scope');
 return {project:source.name,compatibility_date:source.compatibility_date,compatibility_flags:[],r2_buckets:source.r2_buckets,sourceConfigSha256:digest(bytes),routesSha256:digest(routesBytes)};
}
export function uploadConfiguration(policy) {
 const environment={compatibility_date:policy.compatibility_date,compatibility_flags:policy.compatibility_flags,r2_buckets:policy.r2_buckets};
 return {name:policy.project,pages_build_output_dir:'./artifact/publish',...environment,env:{preview:{...environment},production:{...environment}}};
}
export function safeProject(project,environment) {
 check(project?.name==='mdbase-writer'&&/^[A-Za-z0-9-]{1,128}$/.test(project.id??'')&&project.production_branch==='main','project identity/production branch');
 const config=project.deployment_configs?.[environment];
 if(!config||config.compatibility_date==null)return {project:{id:project.id,name:project.name,production_branch:project.production_branch},configuration:null};
 check(typeof config==='object','project runtime configuration unavailable');
 const buckets=config.r2_buckets??{};
 check(typeof config.compatibility_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(config.compatibility_date)&&Array.isArray(config.compatibility_flags??[])&&(config.compatibility_flags??[]).every(flag=>typeof flag==='string'&&/^[a-z0-9_]+$/.test(flag)), 'safe compatibility metadata');
 check(buckets&&typeof buckets==='object'&&!Array.isArray(buckets)&&Object.entries(buckets).every(([binding,bucket])=>/^[A-Za-z0-9_]+$/.test(binding)&&typeof bucket?.name==='string'&&/^[a-z0-9-]+$/.test(bucket.name)), 'safe R2 identity metadata');
 // Explicitly project ONLY safe fields. No whole project/deployment/env_vars output.
 return {project:{id:project.id,name:project.name,production_branch:project.production_branch},configuration:{compatibility_date:config.compatibility_date,compatibility_flags:config.compatibility_flags??[],r2_buckets:Object.fromEntries(Object.entries(buckets??{}).map(([binding,bucket])=>[binding,{name:bucket.name}]))}};
}
export function assertHostingMetadata(policy,metadata,plan,deployment,preflight) {
 check(plan.sdkTrust?.environment==='staging'||plan.sdkTrust?.environment==='production','target');
 const environment=plan.sdkTrust.environment==='production'?'production':'preview';
 const target=writerDeployments[plan.sdkTrust.environment];
 check(plan.pagesBranch===target.branch&&plan.origin===target.origin,'source target/channel/origin');
 check(metadata.project?.name===policy.project&&metadata.project.production_branch==='main'&&/^[A-Za-z0-9-]{1,128}$/.test(metadata.project.id??''),'project identity');
 if(preflight) check(metadata.project.id===preflight.project?.id,'project changed during upload');
 const cfg=metadata.configuration;
 check(cfg?.compatibility_date===policy.compatibility_date&&isDeepStrictEqual(cfg.compatibility_flags,policy.compatibility_flags),'compatibility settings');
 check(isDeepStrictEqual(cfg.r2_buckets,{WRITER_ASSETS:{name:policy.r2_buckets[0].bucket_name}}),'R2 binding/bucket');
 const d=metadata.deployment;
 check(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(deployment?.id??'')&&d?.id===deployment.id&&d.url===deployment.url&&d.sourceSha===plan.sha&&d.sourceSha===deployment.sourceSha&&d.pagesBranch===plan.pagesBranch&&d.pagesBranch===deployment.pagesBranch&&d.environment===environment,'actual deployment/source/channel');
}
export async function readHostingMetadata({policy,plan,deployment,preflight,accountId,apiToken,transport=fetch}) {
 check(accountId&&apiToken,'API credentials unavailable');
 check(['staging','production'].includes(plan.sdkTrust?.environment),'exact target');
 const base=`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/pages/projects/${policy.project}`;
 const get=async suffix=>{
  const response=await transport(base+suffix,{redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${apiToken}`}});
  check(response.ok,'metadata HTTP status');const body=await response.json();check(body.success===true&&body.result,'metadata response');return body.result;
 };
 const environment=plan.sdkTrust.environment==='production'?'production':'preview';
 const safe=safeProject(await get(''),environment);
 if(!deployment) return safe; // No alias GET before first upload.
 check(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(deployment.id??''),'actual UUID required');
 const d=await get('/deployments/'+deployment.id);
 const source=d.deployment_trigger?.metadata;
 const result={...safe,deployment:{id:/^[0-9a-f-]{36}$/.test(d.id??'')?d.id:null,url:/^https:\/\/[0-9a-f]{8,32}\.mdbase-writer\.pages\.dev$/.test(d.url??'')?d.url:null,environment:['preview','production'].includes(d.environment)?d.environment:null,sourceSha:/^[0-9a-f]{40}$/.test(source?.commit_hash??'')?source.commit_hash:null,pagesBranch:['staging','main'].includes(source?.branch)?source.branch:null}};
 try{assertHostingMetadata(policy,result,plan,deployment,preflight);}catch(error){error.safeEvidence=result;throw error;}return result;
}
export function coveredHostingControls(policy,inventory) {
 const routes=inventory.find(r=>r.path==='_routes.json'),worker=inventory.find(r=>r.path==='_worker.js');
 check(routes?.sha256===policy.routesSha256&&worker?.bytes>0,'immutable source routes/precompiled Worker coverage');
 return [routes,worker].map(row=>({...row,evidence:'immutable-upload-inventory + source-config + scoped-deployment/current-project-config + runtime-behavior (NOT live Worker-source GET)'}));
}
