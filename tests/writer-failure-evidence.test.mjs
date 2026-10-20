import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { hostingFixture, hash } from './writer-hosting-fixture.mjs';
import { download } from '../scripts/lib/native-artifact.mjs';
const { parse }=createRequire(new URL('../apps/writer/package.json',import.meta.url))('yaml');
const workflow=parse(await readFile(new URL('../.github/workflows/deploy-writer.yml',import.meta.url),'utf8'));
const source='a'.repeat(40),tree='b'.repeat(40);
for(const stage of ['source','pnpm_setup','node_setup','intake','install','members','source_check','build'])test(stage+' failure retains separate unprivileged evidence while qualified artifact and protected job SKIP',()=>{
 const build=workflow.jobs['native-build'],steps=build.steps;
 // Model the runner's default success() skip and failure() continuation, using
 // actual parsed workflow conditions rather than a made-up alternate job graph.
 let failed=false;const reached=[];
 for(const step of steps){
  const outcome=failed?'skipped':step.id===stage?'failure':'success';
  const runs=step.if==='failure()'?failed:step.if===undefined||step.if==='success()'?!failed:false;
  if(runs){reached.push(step);if(outcome==='failure')failed=true;}
 }
 assert.equal(failed,true,'stage must have a named actual step');
 const qualified=reached.filter(s=>s.id==='artifact');
 const receipts=reached.filter(s=>s.id==='build_failure_receipt');
 const failures=reached.filter(s=>s.id==='build_failure_artifact');
 assert.equal(qualified.length,0);assert.equal(receipts.length,1);assert.equal(failures.length,1);
 assert.match(failures[0].with.name,/^writer-native-build-failure-/);
 assert.match(failures[0].with.path,/writer-build-failure/);
 assert.doesNotMatch(JSON.stringify(build.outputs),/build_failure/);
 assert.match(JSON.stringify(build.outputs),/steps\.artifact\.outputs/);
 assert.deepEqual(workflow.jobs['native-deploy'].needs,['native-inputs','native-build']);
 assert.ok(!workflow.jobs['native-deploy'].if||!workflow.jobs['native-deploy'].if.includes('always()'));
 assert.doesNotMatch(JSON.stringify(receipts[0]),/secrets\.|CLOUDFLARE|wrangler|pnpm |toJSON|node scripts\/|SDK/);
 assert.doesNotMatch(JSON.stringify(build),/secrets\.|CLOUDFLARE_API_TOKEN|"environment"/);
});
for(const stage of ['intake','members','build'])test(stage+' inline failure receipt executes stdlib only and retains minimal public context',async t=>{
 const f=await hostingFixture(t),step=workflow.jobs['native-build'].steps.find(s=>s.id==='build_failure_receipt');
 const script=step.run.match(/^node <<'NODE'\n([\s\S]*?)\nNODE\n?$/)?.[1];assert.ok(script);
 const names={source:'STEP_SOURCE',pnpm_setup:'STEP_PNPM',node_setup:'STEP_NODE',intake:'STEP_INTAKE',install:'STEP_INSTALL',members:'STEP_MEMBERS',source_check:'STEP_CHECK',build:'STEP_BUILD',artifact:'STEP_ARTIFACT'};
 const env={PATH:process.env.PATH,FAILURE_DIR:join(f.repoRoot,'failure'),REPOSITORY:'fixture/writer',REPOSITORY_ID:'17',RUN_ID:'23',RUN_ATTEMPT:'2',DISPATCH_REF:'refs/heads/release/native-staging',TARGET:'staging',SOURCE_SHA:source,EVENT_SHA:source,PRIVATE_TOKEN:'must-not-appear'};
 let failed=false;
 for(const [id,name] of Object.entries(names)){env[name]=failed?'skipped':id===stage?'failure':'success';if(id===stage)failed=true;}
 execFileSync(process.execPath,['-e',script],{cwd:f.repoRoot,env});
 const text=await readFile(join(env.FAILURE_DIR,'receipt.json'),'utf8'),receipt=JSON.parse(text);
 assert.doesNotMatch(text,/must-not-appear|PRIVATE_TOKEN|artifact-id|artifact-digest/);
 assert.equal(receipt.status,'build-failed');assert.equal(receipt.failedStage,stage);assert.equal(receipt.steps[stage],'failure');
 assert.equal(receipt.repository,'fixture/writer');assert.equal(receipt.repositoryId,'17');assert.equal(receipt.run,'23');assert.equal(receipt.attempt,'2');assert.equal(receipt.ref,env.DISPATCH_REF);assert.equal(receipt.target,'staging');
 assert.deepEqual(receipt.source,{requestedSha:source,eventSha:source,checkoutSha:null,tree:null});
 assert.deepEqual([...script.matchAll(/require\('([^']+)'\)/g)].map(m=>m[1]),['node:fs','node:path','node:child_process']);
 assert.match(script,/\['rev-parse',ref\]/);assert.doesNotMatch(script,/console\.|import\(|execSync|eval\(/);
});
async function transportFixture(t,changes={}){
 const f=await hostingFixture(t),root=f.artifactRoot;
 const expected={id:'42',repository:'fixture/writer',repositoryId:'17',run:'23',attempt:'2',source,tree,target:'staging'};
 const inventoryBytes=JSON.stringify(f.inventory),planBytes=JSON.stringify(f.plan),runtimeBytes=await readFile(join(root,'runtime.json'));
 await writeFile(join(root,'inventory.json'),inventoryBytes);await writeFile(join(root,'plan.json'),planBytes);
 await writeFile(join(root,'envelope.json'),JSON.stringify({...expected,inventorySha256:hash(inventoryBytes),planSha256:hash(planBytes),runtimeSha256:hash(runtimeBytes)}));
 const zip=join(f.repoRoot,'original.zip');
 execFileSync('python3',['-B','-c',`import os,sys,zipfile
with zipfile.ZipFile(sys.argv[2],'w') as z:
 for root,dirs,files in os.walk(sys.argv[1]):
  for name in files:
   path=os.path.join(root,name);z.write(path,os.path.relpath(path,sys.argv[1]))`,root,zip]);
 const bytes=await readFile(zip);expected.digest=changes.wrongDigest?'sha256:'+'0'.repeat(64):'sha256:'+hash(bytes);
 const meta={id:42,digest:expected.digest,expired:false,name:'writer-native-build-staging-23-2',workflow_run:{id:23,repository_id:17,head_repository_id:17,head_sha:source,head_branch:'release/native-staging'},archive_download_url:'https://blob.invalid/?sig=private-metadata'};
 const run={id:23,workflow_id:7,path:'.github/workflows/deploy-writer.yml',repository:{id:17,full_name:'fixture/writer'},head_repository:{id:17,full_name:'fixture/writer'},head_sha:source,run_attempt:2,event:'workflow_dispatch',head_branch:'release/native-staging',env:{DONT:'private-context'}};
 let metadataCalls=0,runCalls=0,zipCalls=0;
 const transport=async(url,init)=>{
  url=String(url);
  if(url.endsWith('/actions/artifacts/42')){
   metadataCalls++;if(changes.firstLookupError&&metadataCalls===1)throw Error('private-token URL');
   return {ok:true,json:async()=>({...structuredClone(meta),...(metadataCalls===1?changes.before:changes.after)})};
  }
  if(url.endsWith('/actions/runs/23')){
   runCalls++;if(changes.runAfterError&&runCalls===2)throw Error('private-query');
   const result=structuredClone(run);
   if(runCalls===1)Object.assign(result,changes.initialRun??{});
   if(runCalls===2)Object.assign(result,changes.afterRun??{});
   return {ok:true,json:async()=>result};
  }
  if(url.endsWith('/zip')){zipCalls++;return {status:302,headers:new Headers({location:'https://artifact.example.test/blob?sig=private-sas'})};}
  if(url.startsWith('https://artifact.example.test/')){assert.equal(init.headers,undefined);return new Response(bytes);}
  throw Error('unexpected mocked request');
 };
 const downloadRoot=join(f.repoRoot,'download/artifact'),evidencePath=join(f.repoRoot,'download/artifact-metadata.json');
 const evidence=async()=>{const text=await readFile(evidencePath,'utf8');assert.doesNotMatch(text,/private-|archive_download_url|Authorization|"env"/);return JSON.parse(text);};
 return {...f,expected,bytes,downloadRoot,transport,evidence,counts:()=>({metadataCalls,runCalls,zipCalls})};
}
test('wrong INITIAL attempt persists observed run before refusing without any ZIP fetch',async t=>{
 const f=await transportFixture(t,{initialRun:{run_attempt:1}});
 await assert.rejects(download(f.expected,f.downloadRoot,f.transport,f.repoRoot));
 const e=await f.evidence();assert.equal(e.run.run_attempt,1);assert.equal(e.before.id,42);assert.equal(f.counts().zipCalls,0);assert.ok(e.refusal.reason);
});
test('download digest refusal retains independently observed actual ZIP SHA before validation',async t=>{
 const f=await transportFixture(t,{wrongDigest:true});await assert.rejects(download(f.expected,f.downloadRoot,f.transport,f.repoRoot));
 const e=await f.evidence();assert.equal(e.downloadedSha256,hash(f.bytes));assert.notEqual('sha256:'+e.downloadedSha256,f.expected.digest);assert.equal(e.run.run_attempt,2);assert.ok(e.refusal.reason);
});
test('after metadata survives a subsequent runAfter lookup error without losing earlier observations',async t=>{
 const f=await transportFixture(t,{runAfterError:true});await assert.rejects(download(f.expected,f.downloadRoot,f.transport,f.repoRoot));
 const e=await f.evidence();assert.equal(e.after.id,42);assert.equal(e.run.id,23);assert.equal(e.downloadedSha256,hash(f.bytes));assert.equal(e.runAfter,undefined);assert.equal(e.refusal.stage,'run-after-lookup');
});
test('wrong AFTER attempt is observed, retained and refused',async t=>{
 const f=await transportFixture(t,{afterRun:{run_attempt:3}});await assert.rejects(download(f.expected,f.downloadRoot,f.transport,f.repoRoot));
 const e=await f.evidence();assert.equal(e.runAfter.run_attempt,3);assert.equal(e.run.run_attempt,2);assert.equal(e.after.id,42);assert.equal(f.counts().runCalls,2);
});
test('first lookup error retains minimal expected plus safe failure, no fabricated observations',async t=>{
 const f=await transportFixture(t,{firstLookupError:true});await assert.rejects(download(f.expected,f.downloadRoot,f.transport,f.repoRoot));
 const e=await f.evidence();assert.equal(e.expected.run,'23');assert.equal(e.before,undefined);assert.equal(e.run,undefined);assert.equal(e.after,undefined);assert.equal(e.refusal.stage,'before-lookup');
});
for(const [name,change] of Object.entries({runId:{id:24},repositoryId:{repository:{id:18,full_name:'fixture/writer'}},headRepositoryId:{head_repository:{id:18,full_name:'fixture/writer'}},workflow:{path:'.github/workflows/other.yml'},event:{event:'push'},branch:{head_branch:'main'},source:{head_sha:'d'.repeat(40)}}))test('canonical initial run '+name+' binding fails before ZIP fetch',async t=>{
 const f=await transportFixture(t,{initialRun:change});await assert.rejects(download(f.expected,f.downloadRoot,f.transport,f.repoRoot));
 const e=await f.evidence();assert.ok(e.run);assert.equal(f.counts().zipCalls,0);assert.ok(e.refusal.reason);
});
for(const [name,change] of Object.entries({runId:{id:24},repositoryId:{repository:{id:18,full_name:'fixture/writer'}},headRepositoryId:{head_repository:{id:18,full_name:'fixture/writer'}},workflow:{path:'.github/workflows/other.yml'},workflowId:{workflow_id:8},event:{event:'push'},branch:{head_branch:'main'},source:{head_sha:'d'.repeat(40)}}))test('canonical AFTER run '+name+' binding refuses and retains the observation',async t=>{
 const f=await transportFixture(t,{afterRun:change});await assert.rejects(download(f.expected,f.downloadRoot,f.transport,f.repoRoot));
 const e=await f.evidence();assert.ok(e.runAfter);assert.equal(e.after.id,42);assert.equal(f.counts().runCalls,2);assert.ok(e.refusal.reason);
 for(const [key,value] of Object.entries(change))assert.deepEqual(e.runAfter[key],value);
});
test('wrong after-artifact digest is persisted before refusal and no later lookup',async t=>{
 const f=await transportFixture(t,{after:{digest:'sha256:'+'d'.repeat(64)}});await assert.rejects(download(f.expected,f.downloadRoot,f.transport,f.repoRoot));
 const e=await f.evidence();assert.equal(e.after.digest,'sha256:'+'d'.repeat(64));assert.equal(f.counts().runCalls,1);assert.ok(e.run);assert.ok(e.downloadedSha256);
});
test('full positive transport preserves every observation including after-run workflow identity',async t=>{
 const f=await transportFixture(t);await download(f.expected,f.downloadRoot,f.transport,f.repoRoot);
 const e=await f.evidence();assert.equal(e.stage,'complete');assert.equal(e.refusal,null);assert.equal(e.run.workflow_id,7);assert.equal(e.runAfter.workflow_id,7);assert.equal(e.runAfter.path,'.github/workflows/deploy-writer.yml');assert.equal(e.after.id,42);assert.equal(e.downloadedSha256,hash(f.bytes));assert.deepEqual(f.counts(),{metadataCalls:2,runCalls:2,zipCalls:1});
});
