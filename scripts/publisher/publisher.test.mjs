// Public data and transport doubles; no deployment or credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, readFile, mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from 'node:test';
import { createRequire } from 'node:module';
const {parse}=createRequire(new URL('../../apps/writer/package.json',import.meta.url))('yaml');
import { assertDispatch, assertCheckout, assertAncestor, deploymentFor } from './refs.mjs';
import { sourceRoot } from './publisher.mjs';
import { loadOriginals, productionPin, compareInstalled, protectedHashes } from './originals.mjs';
import { authenticateProduction, stagingArchive } from './authentication.mjs';
import { prepareInstall } from './install-inputs.mjs';
import { capturePrevious, rollback } from './rollback.mjs';
import { assertArtifactMetadata, assertArtifactRun, assertArtifactDirectory } from './artifact.mjs';


import { captureDeployment, createReceipt } from './publisher.mjs';
const repoRoot=fileURLToPath(new URL('../../',import.meta.url));
const hashes={WRITER_TRUST_ASSET_SHA256:'7912e40838213e60b65848350d319a48019021317b112e3326429b250f0133d7'};
const source='a'.repeat(40),tree='b'.repeat(40),origin='https://staging.mdbase-writer.pages.dev';
const uuid='12345678-1234-4234-8234-123456789abc';
const env={TARGET:'staging',SOURCE_SHA:source,GITHUB_SHA:tree,GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch'};
const expected={id:'10',digest:'sha256:'+'c'.repeat(64),repository:'mdbase-dev/mdbase-connect',repositoryId:'20',run:'30',attempt:'1',event:'workflow_dispatch',ref:env.GITHUB_REF,workflowSha:tree,source,tree,target:'staging'};
const metadata={id:10,expired:false,digest:expected.digest,name:'writer-build-staging-30-1',workflow_run:{id:30,head_sha:tree,head_repository_id:20}};
const run={id:30,head_sha:tree,run_attempt:1,event:expected.event,head_branch:'main',path:'.github/workflows/deploy-writer.yml',repository:{id:20,full_name:expected.repository}};
const deployment={id:uuid,url:'https://12345678.mdbase-writer.pages.dev',sourceSha:source,pagesBranch:'staging'};
const sha=b=>createHash('sha256').update(b).digest('hex');

it('admits an exact clean ancestor even when main and the dispatch SHA move ahead',async()=>{
 const root=await mkdtemp(join(tmpdir(),'editor-ancestry-'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 try {
  git('init');git('config','user.email','test@example.invalid');git('config','user.name','Test');
  git('commit','--allow-empty','-m','source');const sha=git('rev-parse','HEAD');
  git('commit','--allow-empty','-m','main advanced');git('update-ref','refs/remotes/origin/main','HEAD');
  git('checkout','--detach',sha);
  const binding=assertDispatch({...env,SOURCE_SHA:sha});
  assert.equal(assertCheckout(binding,root).sha,sha);
  git('checkout','--orphan','unrelated');git('commit','--allow-empty','-m','not main');
  const other=git('rev-parse','HEAD');
  assert.throws(()=>assertCheckout({...binding,sha:other},root),/ancestor/);
  assert.throws(()=>assertAncestor({...binding,sha:other},root),/ancestor/);
  for(const patch of [{SOURCE_SHA:'abcd'},{GITHUB_EVENT_NAME:'push'},{GITHUB_REF:'refs/tags/v1'},{TARGET:'lab'}])assert.throws(()=>assertDispatch({...env,...patch}));
 }finally{await rm(root,{recursive:true,force:true});}
});
async function originalsFixture() {
 const root=await mkdtemp(join(tmpdir(),'editor-originals-')),app=join(root,'apps/writer');
 await mkdir(app,{recursive:true});
 await cp(join(repoRoot,'vendor'),join(root,'vendor'),{recursive:true});
 await cp(join(repoRoot,'apps/writer/vendor'),join(app,'vendor'),{recursive:true});
 await cp(join(repoRoot,'patches'),join(root,'patches'),{recursive:true});
 await cp(join(repoRoot,'config'),join(root,'config'),{recursive:true});
 const pkg=JSON.parse(await readFile(join(repoRoot,'apps/writer/package.json'),'utf8'));
 await writeFile(join(app,'package.json'),JSON.stringify(pkg));
 let lock=(await readFile(join(repoRoot,'pnpm-lock.yaml'),'utf8')).replace(/\npatchedDependencies:\n[\s\S]*?(?=\nimporters:)/,'').replace(/\\(patch_hash=[a-f0-9]+\\)/g,'');
 const uiDir=join(root,'ui/package');await mkdir(uiDir,{recursive:true});
 await writeFile(join(uiDir,'package.json'),JSON.stringify({name:'@mdbase-dev/ui',version:pkg.dependencies['@mdbase-dev/ui']}));
 await writeFile(join(uiDir,'index.js'),'export const value=1;');
 const ui=execFileSync('tar',['-czf','-','-C',join(root,'ui'),'package']);
 const integrity='sha512-'+createHash('sha512').update(ui).digest('base64');
 const entry=lock.split(`\n  '@mdbase-dev/ui@${pkg.dependencies['@mdbase-dev/ui']}':\n`)[1].split(/\n  [^ ]/)[0];
 lock=lock.replace(entry,entry.replace(/sha512-[A-Za-z0-9+/]+=*/,integrity));
 await writeFile(join(root,'pnpm-lock.yaml'),lock);
 for(const [name,bytes] of [['@mdbase-dev/sdk',(await productionPin(root)).bytes],['@mdbase-dev/ui',ui],
  ['@mdbase-dev/connect-protocol',await readFile(join(app,pkg.dependencies['@mdbase-dev/connect-protocol'].slice(5)))]]) {
  const installed=join(app,'node_modules',name);await mkdir(installed,{recursive:true});
  execFileSync('tar',['-xzf','-','--strip-components=1','-C',installed],{input:bytes});
 }
 const options={target:'production',repoRoot:root,hashes,fetchImpl:async()=>new Response(ui),
  authenticate:async()=>({kind:'test-double'})};
 return {root,app,options};
}
it('binds current repin metadata, frozen SDK/UI/protocol pins and every installed original member',async()=>{
 const f=await originalsFixture();
 try {
  const plan=await loadOriginals({...f.options,installed:true});
  assert.equal(plan.release.assetSha256,hashes.WRITER_TRUST_ASSET_SHA256);
  assert.throws(()=>protectedHashes({}),/WRITER_TRUST/);
  await assert.rejects(loadOriginals({...f.options,hashes:{WRITER_TRUST_ASSET_SHA256:'0'.repeat(64)}}),/protected trust hash/);
  const {pin}=await productionPin(f.root);
  await writeFile(join(f.root,'vendor',pin.artifact),'wrong archive');
  await assert.rejects(loadOriginals(f.options),/committed SDK archive mismatch/);
  await cp(join(repoRoot,'vendor',pin.artifact),join(f.root,'vendor',pin.artifact));
  const path=join(f.app,'node_modules/@mdbase-dev/ui/index.js');
  await writeFile(path,'changed');
  await assert.rejects(compareInstalled(f.root,plan.archives,{fetchImpl:f.options.fetchImpl}),/ALL installed/);
  await rm(path);await assert.rejects(compareInstalled(f.root,plan.archives,{fetchImpl:f.options.fetchImpl}),/ALL installed/);
  await writeFile(path,'export const value=1;');await writeFile(join(f.app,'node_modules/@mdbase-dev/ui/extra'),'extra');
  await assert.rejects(compareInstalled(f.root,plan.archives,{fetchImpl:f.options.fetchImpl}),/ALL installed/);
  await assert.rejects(loadOriginals({...f.options,fetchImpl:async()=>new Response('wrong UI')}),/UI registry archive integrity/);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('checks exact npm integrity and authenticated publisher source before accepting the production archive',async()=>{
 const {pin,bytes}=await productionPin(repoRoot);
 const options={fetchImpl:async()=>Response.json({name:'@mdbase-dev/sdk',version:pin.version,dist:{integrity:pin.sri}}),
  prove:async(name,baseline)=>{assert.equal(name,'@mdbase-dev/sdk');assert.equal(baseline.workflow,'publish-sdk-npm.yml');return {commit:pin.sourceCommit,identity:`https://github.com/mdbase-dev/mdbase-connect/.github/workflows/publish-sdk-npm.yml@${pin.publication.ref}`};}};
 await authenticateProduction(pin,bytes,options);
 await assert.rejects(authenticateProduction(pin,Buffer.from('wrong'),options),/integrity/);
 await assert.rejects(authenticateProduction(pin,bytes,{...options,prove:async()=>({commit:source})}),/source mismatch/);
 await assert.rejects(authenticateProduction(pin,bytes,{...options,prove:async()=>{throw Error('bad certificate');}}),/certificate/);
});
it('pins staging to the production version and verifies both release digests and the repository/workflow/source attestation',async()=>{
 const {pin}=await productionPin(repoRoot),bytes=Buffer.from('staging'),proof=Buffer.from('{}');
 const prefix=`https://github.com/mdbase-dev/mdbase-connect/releases/download/sdk-v${pin.version}/`;
 const release={tag_name:'sdk-v'+pin.version,prerelease:true,draft:false,assets:[
  {name:'sdk-staging.tgz',digest:'sha256:'+sha(bytes),browser_download_url:prefix+'sdk-staging.tgz'},
  {name:'sdk-staging.tgz.sigstore.json',digest:'sha256:'+sha(proof),browser_download_url:prefix+'sdk-staging.tgz.sigstore.json'}]};
 let called=false;
 const options={fetchImpl:async url=>url.includes('api.github.com')?Response.json(release):new Response(url.endsWith('.json')?proof:bytes),
  run:(command,args)=>{called=true;assert.equal(command,'gh');assert.ok(args.includes('--bundle'));assert.ok(args.includes(pin.sourceCommit));assert.ok(args.includes('mdbase-dev/mdbase-connect/.github/workflows/publish-sdk-npm.yml'));}};
 assert.equal((await stagingArchive(pin,options)).authentication.sha256,sha(bytes));assert.equal(called,true);
 await assert.rejects(stagingArchive(pin,{...options,fetchImpl:async url=>url.includes('api.github.com')?Response.json(release):new Response('wrong')}),/digest mismatch/);
 await assert.rejects(stagingArchive(pin,{...options,run:()=>{throw Error('invalid signature');}}),/attestation verification failed/);
});
it('derives the staging frozen install without changing any other dependency',async()=>{
 const f=await originalsFixture();
 try {
  const plan={target:'staging',sdkTrust:await loadOriginals(f.options)};
  const originalLock=await readFile(join(f.root,'pnpm-lock.yaml'),'utf8');
  const originalPackage=JSON.parse(await readFile(join(f.app,'package.json'),'utf8'));
  const bytes=Buffer.from('authenticated staging archive');
  plan.sdkTrust.archives.sdk={path:'https://example.invalid/sdk-staging.tgz',sha256:sha(bytes),sri:'sha512-staging'};
  await prepareInstall(plan,f.root,async()=>new Response(bytes));
  const pkg=JSON.parse(await readFile(join(f.app,'package.json'),'utf8'));
  assert.equal(pkg.dependencies['@mdbase-dev/sdk'],'file:../../vendor/sdk-staging.tgz');
  const lock=await readFile(join(f.root,'pnpm-lock.yaml'),'utf8');
  assert.ok(lock.includes('sha512-staging'));assert.ok(!lock.includes(plan.sdkTrust.production.sri));
  const stagingPath='file:vendor/sdk-staging.tgz',alias='@mdbase-dev/sdk-staging@'+stagingPath;
  assert.equal(parse(lock).importers['apps/writer'].dependencies['@mdbase-dev/sdk'].version,alias);
  const version=plan.sdkTrust.production.version;
  const restored=lock.replace(`specifier: file:../../vendor/sdk-staging.tgz\n        version: '${alias}'`,
    `specifier: ${version}\n        version: ${version}`)
   .replaceAll(`'@mdbase-dev/sdk': '${alias}'`,`'@mdbase-dev/sdk': ${version}`)
   .replaceAll(alias,'@mdbase-dev/sdk@'+version)
   .replace(`resolution: {integrity: sha512-staging, tarball: ${stagingPath}}\n    name: '@mdbase-dev/sdk-staging'\n    version: ${version}`,
    `resolution: {integrity: ${plan.sdkTrust.production.sri}}`);
  assert.equal(restored,originalLock,'only the SDK source, integrity and peer identity change');
  pkg.dependencies['@mdbase-dev/sdk']=originalPackage.dependencies['@mdbase-dev/sdk'];
  assert.deepEqual(pkg,originalPackage);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('rolls production back, verifies the previous id and every transitive asset, and keeps failure evidence',async()=>{
 const previousId='87654321-1234-4234-8234-123456789abc',previousUrl='https://87654321.mdbase-writer.pages.dev',failedId='12345678-1234-4234-8234-123456789abc';
 let active=previousId,commit=null;const calls=[];
 const source='c'.repeat(40),clock={t:0,now:()=>clock.t,sleep:async ms=>{clock.t+=ms;}},recovery={source,...clock};
 const bodies={'/':'<script type="module" src="/assets/entry.js"></script><link href="/style.css" rel="stylesheet">','/assets/entry.js':'import("./chunk.js");fetch("/wasm/pandoc-1.0.0.wasm");fetch("assets/engine.wasm");fetch("./gone.wasm");new URL("./workers.v1/pool.js",import.meta.url)','/assets/chunk.js':'new URL("worker.js",import.meta.url)','/assets/engine.wasm':'previous wasm','/assets/worker.js':'previous worker','/assets/workers.v1/pool.js':'previous pool','/style.css':'previous style'};
 const options={accountId:'a'.repeat(32),apiToken:'test-double',fetchImpl:async(url,init)=>{
  calls.push({url,method:init.method});
  if(url.includes('/rollback')){active=previousId;return Response.json({success:true,result:{id:previousId}});}
  if(url.includes('api.cloudflare.com'))return Response.json({success:true,result:{name:'mdbase-writer',production_branch:'main',canonical_deployment:{id:active,url:previousUrl,environment:'production',deployment_trigger:{metadata:{commit_hash:commit}}}}});
  const path=new URL(url).pathname;
  if(path.endsWith('.json'))return new Response('manifest');
  if(path.endsWith('.wasm') && !bodies[path])return new Response('<html>spa</html>',{headers:{'content-type':'text/html'}});
  return new Response(bodies[path]??'previous asset');
 }};
 const previous=await capturePrevious(options);
 for(const path of ['/assets/entry.js','/assets/chunk.js','/assets/worker.js','/assets/workers.v1/pool.js','/assets/engine.wasm','/style.css'])assert.ok(previous.probes.some(p=>p.path===path),path);
 assert.ok(!previous.probes.some(p=>p.path==='/assets/gone.wasm'),'SPA fallback is not a build asset');
 assert.ok(!calls.some(c=>c.url.includes('/wasm/pandoc')),'versioned R2 modules stay outside the Pages snapshot');
 const plan={target:'production',origin:'https://writer.mdbase.dev'};
 active=failedId;commit=source;
 const report=await rollback(previous,options,recovery);
 assert.equal(report.ok,true);assert.equal(report.restored,true);assert.equal(report.previousId,previousId);
 assert.equal(calls.filter(c=>c.method==='POST').length,1);
 assert.equal(createReceipt({plan,verification:{ok:false},previous,rollback:report}).rollback.ok,true);
 const untouched=await rollback(previous,options,recovery);
 assert.equal(untouched.ok,true);assert.equal(untouched.restored,false);
 assert.equal(calls.filter(c=>c.method==='POST').length,1,'nothing to undo when the previous deployment is active');
 active=failedId;commit='d'.repeat(40);
 const newer=await rollback(previous,options,recovery);
 assert.equal(newer.ok,false);assert.equal(newer.refused,true);
 assert.equal(calls.filter(c=>c.method==='POST').length,1,'a newer publication is never undone');
 active=previousId;commit=source;
 let reads=0;
 const late=await rollback(previous,{...options,fetchImpl:async(url,init)=>{
  if(url.endsWith('/mdbase-writer') && ++reads===2)active=failedId;
  return options.fetchImpl(url,init);
 }},recovery);
 assert.equal(late.ok,true);assert.equal(late.restored,true,'an upload that lands during verification is still undone');
 assert.equal(active,previousId);
 for(const probe of previous.probes) {
  const broken=await rollback(previous,{...options,fetchImpl:async(url,init)=>url===plan.origin+probe.path?new Response('wrong bytes'):options.fetchImpl(url,init)},{source,settleMs:100});
  assert.equal(broken.ok,false,'rollback must match '+probe.path);
 }
 const staleHeaders=(path,type)=>async(url,init)=>{
  if(url!==plan.origin+path)return options.fetchImpl(url,init);
  const response=await options.fetchImpl(url,init);
  return new Response(response.body,{headers:{'content-type':type,'content-security-policy':"default-src 'self'"}});
 };
 assert.equal((await rollback(previous,{...options,fetchImpl:staleHeaders('/assets/engine.wasm','application/wasm')},recovery)).ok,true,'unchanged bytes may keep another build\'s headers at the edge');
 const htmlPrevious={...previous,probes:previous.probes.map(p=>p.path==='/'?{...p,headers:{...p.headers,'content-type':'text/html'}}:p)};
 assert.equal((await rollback(htmlPrevious,{...options,fetchImpl:staleHeaders('/','text/html')},{source,settleMs:100})).ok,false,'documents must match exactly');
 await assert.rejects(capturePrevious({...options,fetchImpl:async(url,init)=>url===plan.origin+'/assets/entry.js'?new Response('missing',{status:404}):options.fetchImpl(url,init)}),/bytes unavailable/);
 assert.equal(createReceipt({plan,verification:{ok:false},previous,rollback:report}).status,'failed-or-incomplete');
});
it('binds immutable artifact metadata AND the exact workflow/run attempt/manual ref',()=>{
 assertArtifactMetadata(metadata,expected);assertArtifactRun(run,expected);
 for(const patch of [{expired:true},{digest:'sha256:'+'d'.repeat(64)},{name:'writer-build-staging-30-2'},{workflow_run:{...metadata.workflow_run,head_repository_id:99}}])assert.throws(()=>assertArtifactMetadata({...metadata,...patch},expected));
 for(const patch of [{run_attempt:2},{event:'push'},{head_branch:'other'},{path:'.github/workflows/native-journal.yml'},{head_sha:source}])assert.throws(()=>assertArtifactRun({...run,...patch},expected));
});
it('uses page20 and resolves only the unique uploaded URL/full source/channel to a FULL UUID',async()=>{
 const entry={id:uuid,url:deployment.url,deployment_trigger:{metadata:{commit_hash:source,branch:'staging'}}};
 const options={output:'Success '+deployment.url,target:'staging',sha:source,accountId:'a'.repeat(32),apiToken:'fixture'};
 const capture=rows=>captureDeployment({...options,fetchImpl:async url=>{assert.match(url,/\/mdbase-writer\/deployments\?per_page=20$/);return Response.json({success:true,result:rows});}});
 assert.deepEqual(await capture([entry]),deployment);
 // Re-uploading identical source is not a source conflict: identify the new URL.
 const prior={...entry,id:'87654321-1234-4234-8234-123456789abc',url:'https://87654321.mdbase-writer.pages.dev'};
 assert.deepEqual(await capture([entry,prior]),deployment);
 for(const bad of [{...entry,id:'12345678'},{...entry,url:'https://87654321.mdbase-writer.pages.dev'},
  {...entry,deployment_trigger:{metadata:{commit_hash:tree,branch:'staging'}}},{...entry,deployment_trigger:{metadata:{commit_hash:source,branch:'main'}}}])await assert.rejects(capture([bad]),/UUID/);
 await assert.rejects(capture([entry,entry]),/UUID/);
});

it('authenticates the real SDK and compares the installed SDK, protocol and reviewed patched UI',async()=>{
 const intake=await loadOriginals({target:'production',repoRoot,hashes,installed:true});
 assert.equal(intake.authentication.kind,'npm-provenance');
 assert.equal(intake.archives.ui.patch.sha256,createHash('sha256').update(await readFile(join(repoRoot,intake.archives.ui.patch.path))).digest('hex'));
});
it('reads candidate data from the source root, not the workflow checkout',()=>{
 assert.equal(sourceRoot({WRITER_SOURCE_ROOT:'/candidate'}),'/candidate');
 assert.equal(sourceRoot({}),process.cwd());
});
