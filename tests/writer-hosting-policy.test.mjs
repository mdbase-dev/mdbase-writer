import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { inventoryDirectory } from '../scripts/lib/native-publish-bytes.mjs';
import { assertRuntimeOriginals, deriveRuntimeOriginals, runtimeSourcePins } from '../scripts/lib/writer-runtime-originals.mjs';
import { sourceHostingPolicy, uploadConfiguration, readHostingMetadata, assertHostingMetadata } from '../scripts/lib/writer-hosting-policy.mjs';
import { assertInventoryCoverage, createReceipt } from '../apps/writer/scripts/native-publisher.mjs';
import { verifyServedAssets } from '../apps/writer/scripts/verify-served.mjs';
import { hostingFixture } from './writer-hosting-fixture.mjs';
const origin='https://staging.mdbase-writer.pages.dev';
test('static bytes alone cannot bypass required source runtime/deployment policy',async t=>{
 const f=await hostingFixture(t);
 const inventory=f.inventory.filter(r=>!['_routes.json','_worker.js'].includes(r.path));
 const result=await verifyServedAssets({origin,inventory,fetch:f.fetch,attempts:1});
 assert.equal(result.ok,false);
});
test('known uploaded routes and Worker clear ONLY with source config, actual metadata and all runtime bytes/behavior',async t=>{
 const f=await hostingFixture(t);
 const result=await verifyServedAssets({origin,inventory:f.inventory,publication:f.publication,fetch:f.fetch,attempts:1});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.unverified.length,0);
 assert.equal(result.runtimeVerified.length,2);
 assert.equal(result.policyEvidence.coveredControls.length,2);
 assert.ok(result.verified.every(r=>r.path!=='_worker.js'));
 const args={target:'staging',source:{sha:f.plan.sha,tree:f.plan.tree},releaseRef:'release/native-staging',sdkTrust:{},inventory:f.inventory,deploymentId:f.deployment.id,verification:result};
 assert.equal(createReceipt(args).status,'verified');
 assert.equal(createReceipt({...args,verification:{ok:true,policy_verified:true,verified:f.inventory,failures:[],unverified:[]}}).status,'failed-or-incomplete');
});
test('official advanced-mode Worker directory retains EVERY module/map in inventory and hosting evidence',async t=>{
 const f=await hostingFixture(t); // SYNTHETIC data only, not compiled app output.
 await rm(join(f.publish,'_worker.js'));
 for(const [name,body] of Object.entries({'index.js':'export default {};','module.mjs':'export {};','index.js.map':'{}'}))await f.put(join(f.publish,'_worker.js',name),body);
 const inventory=await inventoryDirectory(f.publish);
 assert.doesNotThrow(()=>assertInventoryCoverage(inventory,{nativeAssets:{}}));
 const result=await verifyServedAssets({origin,inventory,publication:f.publication,fetch:f.fetch,attempts:1});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.deepEqual(result.policyEvidence.coveredControls.map(a=>a.path).sort(),['_routes.json','_worker.js/index.js','_worker.js/index.js.map','_worker.js/module.mjs']);
 assert.ok(result.verified.every(a=>!a.path.startsWith('_worker.js/')));
 const args={target:'staging',source:{sha:f.plan.sha,tree:f.plan.tree},releaseRef:'release/native-staging',sdkTrust:{},inventory,deploymentId:f.deployment.id,verification:result};
 assert.equal(createReceipt(args).status,'verified');
 const omitted=structuredClone(result);omitted.policyEvidence.coveredControls.pop();
 assert.equal(createReceipt({...args,verification:omitted}).status,'failed-or-incomplete');
 const changed=structuredClone(result);changed.policyEvidence.coveredControls[1].sha256='0'.repeat(64);
 assert.equal(createReceipt({...args,verification:changed}).status,'failed-or-incomplete');
 assert.throws(()=>assertInventoryCoverage(inventory.filter(a=>a.path!=='_worker.js/index.js'),{nativeAssets:{}}),/Missing precompiled Pages Worker/);
});
for(const field of ['bucket','compatibility','deployment']) test('even exact static bytes refuse wrong '+field+' metadata',async t=>{
 const f=await hostingFixture(t),metadata=structuredClone(f.metadata);
 if(field==='bucket') metadata.configuration.r2_buckets.WRITER_ASSETS.name='wrong-bucket';
 if(field==='compatibility') metadata.configuration.compatibility_date='2020-01-01';
 if(field==='deployment') metadata.deployment.sourceSha='b'.repeat(40);
 const inventory=f.inventory.filter(r=>!['_routes.json','_worker.js'].includes(r.path));
 const result=await verifyServedAssets({origin,inventory,publication:{...f.publication,metadata},fetch:f.fetch,attempts:1});
 assert.equal(result.ok,false);
});

test('production policy uses production channel/origin with the same independently pinned runtime originals',async t=>{
 const f=await hostingFixture(t),production='https://writer.mdbase.dev';
 const publication={...f.publication,plan:{...f.plan,pagesBranch:'main',origin:production,sdkTrust:{environment:'production'}},deployment:{...f.deployment,pagesBranch:'main'},metadata:{...f.metadata,deployment:{...f.metadata.deployment,pagesBranch:'main',environment:'production'}}};
 const result=await verifyServedAssets({origin:production,inventory:f.inventory,publication,fetch:f.fetch,attempts:1});
 assert.equal(result.ok,true,JSON.stringify(result));
});
test('source-derived isolated Pages config supplies BOTH channels and no build/hooks',async t=>{
 const f=await hostingFixture(t),policy=await sourceHostingPolicy(f.repoRoot),config=uploadConfiguration(policy);
 assert.equal(config.pages_build_output_dir,'./artifact/publish');
 for(const env of ['preview','production']) assert.deepEqual(config.env[env].r2_buckets,[{binding:'WRITER_ASSETS',bucket_name:'mdbase-writer-assets'}]);
 assert.equal(config.build,undefined);assert.equal(config.main,undefined);
 const pins=await runtimeSourcePins(f.repoRoot);assert.ok(pins.every(p=>p.url.startsWith('https://registry.npmjs.org/')));
});
test('official original SRI/member expectations are rederived, never artifact approval',async t=>{
 const f=await hostingFixture(t);
 assert.deepEqual(await assertRuntimeOriginals(f.repoRoot,f.artifactRoot),f.runtime);
 const fake=structuredClone(f.runtime);fake[0].sha256='0'.repeat(64);
 await writeFile(join(f.artifactRoot,'runtime.json'),JSON.stringify(fake));
 await assert.rejects(assertRuntimeOriginals(f.repoRoot,f.artifactRoot),/expectations differ/);
 await writeFile(join(f.artifactRoot,'runtime.json'),JSON.stringify(f.runtime));
 await writeFile(join(f.artifactRoot,'runtime-originals/typst.tgz'),'tampered');
 await assert.rejects(deriveRuntimeOriginals(f.repoRoot,f.artifactRoot),/original SRI/);
});
for(const name of ['_headers','_redirects','nested/_routes.json'])test('unknown control stays blocking: '+name,async t=>{
 const f=await hostingFixture(t);await f.put(join(f.publish,name),'not approved');
 const inventory=await inventoryDirectory(f.publish),result=await verifyServedAssets({origin,inventory,publication:f.publication,fetch:f.fetch,attempts:1});
 assert.equal(result.ok,false);assert.ok(result.unverified.some(a=>a.path===name));
});
test('changed uploaded route scope and missing Worker cannot be blanket cleared',async t=>{
 const f=await hostingFixture(t);
 await writeFile(join(f.publish,'_routes.json'),JSON.stringify({version:1,include:['/*'],exclude:[]}));
 const result=await verifyServedAssets({origin,inventory:await inventoryDirectory(f.publish),publication:f.publication,fetch:f.fetch,attempts:1});
 assert.equal(result.ok,false);assert.ok(result.unverified.some(a=>a.path==='_routes.json'));
});
for(const kind of ['type','length','cache','etag','status','hash','bytes','missing','error'])test('all actual WASM '+kind+' failures BLOCK including exact static bytes',async t=>{
 const f=await hostingFixture(t),path=f.runtime[0].path;
 const transport=async(url,init)=>{
  if(new URL(url).pathname==='/'+path&&!new Headers(init.headers).has('if-none-match')){
   if(kind==='error')throw Error('private payload MUST NOT appear');
   const good=await f.fetch(url,init),headers=new Headers(good.headers);
   if(kind==='type')headers.set('content-type','text/html');
   if(kind==='length')headers.set('content-length','1');
   if(kind==='cache')headers.set('cache-control','no-store');
   if(kind==='etag')headers.delete('etag');
   if(kind==='status'||kind==='missing')return new Response('bad',{status:kind==='missing'?404:403});
   const body=kind==='hash'?Buffer.alloc(f.data[path].length,120):kind==='bytes'?f.data[path].subarray(1):f.data[path];
   return new Response(body,{headers});
  }
  return f.fetch(url,init);
 };
 const result=await verifyServedAssets({origin,inventory:f.inventory,publication:f.publication,fetch:transport,attempts:1});
 assert.equal(result.ok,false);assert.equal(result.policyEvidence.coveredControls.length,0);
 assert.equal(JSON.stringify(result).includes('private payload'),false);
});
for(const kind of ['conditional-status','conditional-etag','invalid-body','missing-status'])test('trusted runtime route/conditional probe refuses '+kind,async t=>{
 const f=await hostingFixture(t);
 const transport=async(url,init={})=>{
  const path=new URL(url).pathname;
  if(new Headers(init.headers).has('if-none-match')){
   if(kind==='conditional-status')return new Response('',{status:200});
   if(kind==='conditional-etag')return new Response(null,{status:304,headers:{ETag:'"wrong"'}});
  }
  if(kind==='invalid-body'&&path.endsWith('native-publisher-invalid.txt'))return new Response('login',{status:404});
  if(kind==='missing-status'&&path.includes('native-publisher-missing-'))return new Response('Not found',{status:200});
  return f.fetch(url,init);
 };
 const result=await verifyServedAssets({origin,inventory:f.inventory,publication:f.publication,fetch:transport,attempts:1});
 assert.equal(result.ok,false);assert.ok(result.policyFailures.length>0);
});
test('WASM and control probes obey bounded whole-publication deadline even ignoring abort',async t=>{
 const f=await hostingFixture(t);
 for(const hang of ['wasm','probe']){
  const transport=async(url,init)=>{
   if(hang==='wasm'&&url.includes(f.runtime[0].path)||hang==='probe'&&url.includes('native-publisher-invalid'))return new Promise(()=>{});
   return f.fetch(url,init);
  };
  const result=await verifyServedAssets({origin,inventory:f.inventory,publication:f.publication,fetch:transport,attempts:1,timeoutMs:10,totalTimeoutMs:40});
  assert.equal(result.ok,false);assert.equal(result.policyEvidence.coveredControls.length,0);
 }
});
test('metadata comes from scoped GETs and only safe IDs/binding/compat fields survive',async t=>{
 const f=await hostingFixture(t),policy=await sourceHostingPolicy(f.repoRoot);
 const project={...f.metadata.project,env_vars:{DONT:'private payload'},deployment_configs:{preview:{...f.metadata.configuration,env_vars:{TOKEN:{type:'secret_text',value:'private payload'}}}}};
 const deployment={id:f.deployment.id,url:f.deployment.url,environment:'preview',deployment_trigger:{metadata:{commit_hash:f.plan.sha,branch:'staging'}},env_vars:{DONT:'private payload'}};
 const calls=[];
 const transport=async(url,init)=>{calls.push(url);assert.equal(init.redirect,'error');return {ok:true,json:async()=>({success:true,result:url.includes('/deployments/')?deployment:project})};};
 const preflight=await readHostingMetadata({policy,plan:f.plan,accountId:'fixture',apiToken:'fixture',transport});
 assert.equal(calls.length,1);assert.equal(preflight.deployment,undefined);
 const result=await readHostingMetadata({policy,plan:f.plan,deployment:f.deployment,preflight,accountId:'fixture',apiToken:'fixture',transport});
 assert.deepEqual(result,f.metadata);assert.equal(JSON.stringify(result).includes('private payload'),false);
 await assert.rejects(readHostingMetadata({policy,plan:f.plan,deployment:f.deployment,preflight:{project:{id:'changed'}},accountId:'fixture',apiToken:'fixture',transport}),/project changed/);
 project.deployment_configs.preview.r2_buckets.WRITER_ASSETS.name='wrong-bucket';
 await assert.rejects(readHostingMetadata({policy,plan:f.plan,deployment:f.deployment,preflight,accountId:'fixture',apiToken:'fixture',transport}),/R2 binding/);
 await assert.rejects(readHostingMetadata({policy,plan:f.plan,accountId:'fixture',apiToken:'fixture',transport:async()=>({ok:false})}),/metadata HTTP/);
});
test('first upload preflight needs project identity, never a preexisting alias or R2 binding',async t=>{
 const f=await hostingFixture(t),policy=await sourceHostingPolicy(f.repoRoot);
 const project={...f.metadata.project,deployment_configs:{preview:{compatibility_date:policy.compatibility_date}}};
 const transport=async()=>({ok:true,json:async()=>({success:true,result:project})});
 const preflight=await readHostingMetadata({policy,plan:f.plan,accountId:'fixture',apiToken:'fixture',transport});
 assert.deepEqual(preflight.configuration.r2_buckets,{});
 assert.throws(()=>assertHostingMetadata(policy,{...preflight,deployment:f.metadata.deployment},f.plan,f.deployment,preflight),/R2 binding/);
});
test('self-consistent metadata cannot swap staging onto the production Pages channel',async t=>{
 const f=await hostingFixture(t),policy=await sourceHostingPolicy(f.repoRoot);
 const plan={...f.plan,pagesBranch:'main'},deployment={...f.deployment,pagesBranch:'main'},metadata={...f.metadata,deployment:{...f.metadata.deployment,pagesBranch:'main'}};
 assert.throws(()=>assertHostingMetadata(policy,metadata,plan,deployment),/source target/);
});
