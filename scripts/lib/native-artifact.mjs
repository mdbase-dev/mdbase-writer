// GitHub immutable same-run artifact transport, no project dependencies/hooks.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertRuntimeOriginals } from './writer-runtime-originals.mjs';
import { fileURLToPath } from 'node:url';
import { assertInventory, inventoryDirectory } from './native-publish-bytes.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
class ArtifactRefusal extends Error { constructor(reason) { super(`Artifact refusal: ${reason}`); this.reason=reason; } }
const requireValue = (ok, reason) => { if (!ok) throw new ArtifactRefusal(reason); };
export function assertArtifactMetadata(meta, expected) {
  requireValue(meta.id === Number(expected.id) && meta.expired === false && meta.digest === expected.digest && /^sha256:[a-f0-9]{64}$/.test(meta.digest), 'immutable ID/digest');
  requireValue(meta.name === `writer-native-build-${expected.target}-${expected.run}-${expected.attempt}`, 'attempt-bound name');
  requireValue(meta.workflow_run?.id === Number(expected.run) && meta.workflow_run?.head_sha === expected.source && meta.workflow_run?.repository_id === Number(expected.repositoryId) && meta.workflow_run?.head_repository_id === Number(expected.repositoryId) && meta.workflow_run?.head_branch === `release/native-${expected.target}`, 'repository/run/source');
}
export async function assertArtifactDirectory(root, expected, repoRoot = resolve('.')) {
  const envelope = JSON.parse(await readFile(join(root,'envelope.json'),'utf8'));
  for (const key of ['repository','run','attempt','source','tree','target']) requireValue(envelope[key] === expected[key], `envelope ${key}`);
  const inventoryBytes = await readFile(join(root,'inventory.json'));
  const planBytes = await readFile(join(root,'plan.json'));
  requireValue(envelope.inventorySha256 === sha(inventoryBytes) && envelope.planSha256 === sha(planBytes), 'full inventory/plan binding');
  const plan = JSON.parse(planBytes), inventory = JSON.parse(inventoryBytes);
  requireValue(plan.sha === expected.source && plan.tree === expected.tree && plan.sdkTrust.environment === expected.target, 'plan source/tree/target');
  await assertInventory(join(root,'publish'), inventory);
  const runtimeBytes = await readFile(join(root,'runtime.json'));
  requireValue(envelope.runtimeSha256 === sha(runtimeBytes), 'runtime original expectation binding');
  await assertRuntimeOriginals(repoRoot,root);
  const all = await inventoryDirectory(root);
  const attachments=['envelope.json','inventory.json','plan.json','runtime.json','runtime-originals/typst.tgz','runtime-originals/pandoc.tgz'];
  requireValue(all.length === inventory.length + attachments.length && all.every(a => attachments.includes(a.path) || a.path.startsWith('publish/')), 'unexpected artifact paths');
  return {plan,inventory,envelope};
}
export const publisherWorkflowPath='.github/workflows/deploy-writer.yml';
const number=v=>Number.isSafeInteger(v)&&v>0?v:null;
const text=(v,pattern)=>typeof v==='string'&&v.length<=512&&pattern.test(v)?v:null;
const repo=v=>({id:number(v?.id),full_name:text(v?.full_name,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)});
function safeArtifact(v) {
 return {id:number(v?.id),digest:text(v?.digest,/^sha256:[a-f0-9]{64}$/),name:text(v?.name,/^[A-Za-z0-9_.-]+$/),expired:typeof v?.expired==='boolean'?v.expired:null,
  workflow_run:{id:number(v?.workflow_run?.id),repository_id:number(v?.workflow_run?.repository_id),head_repository_id:number(v?.workflow_run?.head_repository_id),head_sha:text(v?.workflow_run?.head_sha,/^[a-f0-9]{40}$/),head_branch:text(v?.workflow_run?.head_branch,/^[A-Za-z0-9_./-]+$/)}};
}
function safeRun(v) {
 return {id:number(v?.id),workflow_id:number(v?.workflow_id),path:text(v?.path,/^[A-Za-z0-9_./-]+$/),repository:repo(v?.repository),head_repository:repo(v?.head_repository),
  run_attempt:number(v?.run_attempt),event:text(v?.event,/^[a-z_]+$/),head_branch:text(v?.head_branch,/^[A-Za-z0-9_./-]+$/),head_sha:text(v?.head_sha,/^[a-f0-9]{40}$/)};
}
export function assertRunIdentity(run,expected,workflowId=run.workflow_id) {
 requireValue(run.id===Number(expected.run)&&run.repository?.id===Number(expected.repositoryId)&&run.repository.full_name===expected.repository&&run.head_repository?.id===Number(expected.repositoryId)&&run.head_repository.full_name===expected.repository,'run repository/id');
 requireValue(run.head_sha===expected.source&&run.run_attempt===Number(expected.attempt)&&run.event==='workflow_dispatch'&&run.head_branch===`release/native-${expected.target}`,'run attempt/event/ref');
 requireValue(number(run.workflow_id)!==null&&run.workflow_id===workflowId&&run.path===publisherWorkflowPath,'run workflow identity');
}
export async function download(expected,root,transport=fetch,repoRoot=resolve('.')) {
 const evidence=join(root,'../artifact-metadata.json');
 await mkdir(join(root,'..'),{recursive:true});
 const observed={expected:{id:text(expected.id,/^[1-9][0-9]*$/),digest:text(expected.digest,/^sha256:[a-f0-9]{64}$/),repository:text(expected.repository,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),repositoryId:text(expected.repositoryId,/^[1-9][0-9]*$/),run:text(expected.run,/^[1-9][0-9]*$/),attempt:text(expected.attempt,/^[1-9][0-9]*$/),source:text(expected.source,/^[a-f0-9]{40}$/),tree:text(expected.tree,/^[a-f0-9]{40}$/),target:text(expected.target,/^(staging|production)$/),workflowPath:publisherWorkflowPath},stage:'before-lookup',refusal:null};
 const checkpoint=async(stage,fields={})=>{Object.assign(observed,fields,{stage});await writeFile(evidence,JSON.stringify(observed,null,2));};
 const base=`https://api.github.com/repos/${expected.repository}`;
 const get=async path=>{
  const response=await transport(base+path,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(30000)});
  requireValue(response.ok,'GitHub metadata unavailable');return response.json();
 };
 await checkpoint('before-lookup');
 try {
  requireValue(Object.values(observed.expected).every(v=>v!==null),'expected identity');
  const before=await get(`/actions/artifacts/${expected.id}`);
  await checkpoint('before-observed',{before:safeArtifact(before)});
  assertArtifactMetadata(before,expected);
  await checkpoint('run-lookup');
  const run=await get(`/actions/runs/${expected.run}`);
  await checkpoint('run-observed',{run:safeRun(run)});
  assertRunIdentity(run,expected);
  await checkpoint('archive-lookup');
  const response=await transport(`${base}/actions/artifacts/${expected.id}/zip`,{headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`},redirect:'manual',signal:AbortSignal.timeout(30000)});
  requireValue(response.status===302,'archive redirect');
  const location=new URL(response.headers.get('location'));
  requireValue(location.protocol==='https:'&&!location.username&&!location.password,'archive HTTPS');
  // Never persist blob/SAS URLs or forward GitHub credentials to blob transport.
  await checkpoint('download-lookup');
  const blob=await transport(location,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(60000)});
  requireValue(blob.ok&&Number(blob.headers.get('content-length'))<=512*1024*1024,'archive size/status');
  const chunks=[];let size=0;
  for await(const chunk of blob.body){size+=chunk.length;requireValue(size<=512*1024*1024,'archive size');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);
  await checkpoint('download-observed',{downloadedSha256:sha(bytes),downloadedBytes:bytes.length});
  requireValue(`sha256:${observed.downloadedSha256}`===expected.digest,'download digest');
  await checkpoint('archive-extract');
  await mkdir(root,{recursive:true});
  const zip=join(root,'../writer-native.zip');await writeFile(zip,bytes,{flag:'wx'});
  execFileSync('python3',['-B','-c',`import pathlib,stat,sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
 seen=set(); total=0
 for i in z.infolist():
  p=pathlib.PurePosixPath(i.filename)
  assert not p.is_absolute() and all(x not in ('','..','.') for x in i.filename.rstrip('/').split('/')) and '\\\\' not in i.filename
  assert i.filename not in seen and not stat.S_ISLNK(i.external_attr >> 16)
  seen.add(i.filename); total+=i.file_size
  assert len(seen)<=20000 and total<=512*1024*1024
 z.extractall(sys.argv[2])`,zip,root]);
  await checkpoint('after-lookup');
  const after=await get(`/actions/artifacts/${expected.id}`);
  await checkpoint('after-observed',{after:safeArtifact(after)});
  assertArtifactMetadata(after,expected);
  await checkpoint('run-after-lookup');
  const runAfter=await get(`/actions/runs/${expected.run}`);
  await checkpoint('run-after-observed',{runAfter:safeRun(runAfter)});
  assertRunIdentity(runAfter,expected,run.workflow_id);
  const postDownloadSha256=sha(await readFile(zip));
  await checkpoint('post-download-observed',{postDownloadSha256});
  requireValue(postDownloadSha256===expected.digest.slice(7),'post-download archive digest');
  await checkpoint('directory-validation');
  await assertArtifactDirectory(root,expected,repoRoot);
  await checkpoint('complete');
 }catch(error){
  // Never persist untrusted error bodies/messages, request headers or URLs.
  observed.refusal={stage:observed.stage,reason:error instanceof ArtifactRefusal?error.reason:'operation-failed'};
  await writeFile(evidence,JSON.stringify(observed,null,2));throw error;
 }
}
if(process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const expected={id:process.env.ARTIFACT_ID,digest:`sha256:${(process.env.ARTIFACT_DIGEST ?? '').replace(/^sha256:/,'')}`,repository:process.env.GITHUB_REPOSITORY,repositoryId:process.env.GITHUB_REPOSITORY_ID,run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,source:process.env.SOURCE_SHA,tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),target:process.env.TARGET};
    await download(expected,process.argv[2]);
  } catch(error) {console.error('Artifact intake refused; see safe artifact-metadata evidence'); process.exitCode=1;}
}
