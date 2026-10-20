// GitHub immutable same-run artifact transport, no project dependencies/hooks.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { assertRuntimeOriginals } from './writer-runtime-originals.mjs';
import { fileURLToPath } from 'node:url';
import { assertInventory, inventoryDirectory } from './native-publish-bytes.mjs';
const sha = b => createHash('sha256').update(b).digest('hex');
const requireValue = (ok, reason) => { if (!ok) throw Error(`Artifact refusal: ${reason}`); };
export function assertArtifactMetadata(meta, expected) {
  requireValue(meta.id === Number(expected.id) && meta.expired === false && meta.digest === expected.digest && /^sha256:[a-f0-9]{64}$/.test(meta.digest), 'immutable ID/digest');
  requireValue(meta.name === `writer-native-build-${expected.target}-${expected.run}-${expected.attempt}`, 'attempt-bound name');
  requireValue(meta.workflow_run?.id === Number(expected.run) && meta.workflow_run?.head_sha === expected.source && meta.workflow_run?.head_repository_id === Number(expected.repositoryId), 'repository/run/source');
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
export async function download(expected, root, transport = fetch) {
  const token = process.env.GITHUB_TOKEN;
  const base = `https://api.github.com/repos/${expected.repository}`;
  const get = async path => {
    const response = await transport(base+path, {headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(30000)});
    requireValue(response.ok, 'GitHub metadata unavailable'); return response.json();
  };
  await mkdir(join(root,'..'),{recursive:true});
  const evidence = join(root,'../artifact-metadata.json');
  const before = await get(`/actions/artifacts/${expected.id}`);
  await writeFile(evidence,JSON.stringify({before,expected},null,2));
  assertArtifactMetadata(before,expected);
  const run = await get(`/actions/runs/${expected.run}`);
  requireValue(run.repository?.full_name === expected.repository && run.head_sha === expected.source && run.run_attempt === Number(expected.attempt) && run.event === 'workflow_dispatch' && run.head_branch === `release/native-${expected.target}`, 'run attempt/event/ref');
  const response = await transport(`${base}/actions/artifacts/${expected.id}/zip`, {headers:{Authorization:`Bearer ${token}`},redirect:'manual',signal:AbortSignal.timeout(30000)});
  requireValue(response.status === 302, 'archive redirect');
  const location = new URL(response.headers.get('location'));
  requireValue(location.protocol === 'https:' && !location.username && !location.password, 'archive HTTPS');
  // Never forward GitHub credentials to the blob endpoint.
  const blob = await transport(location,{redirect:'error',credentials:'omit',signal:AbortSignal.timeout(60000)});
  requireValue(blob.ok && Number(blob.headers.get('content-length')) <= 512*1024*1024,'archive size/status');
  const chunks=[]; let size=0;
  for await (const chunk of blob.body) { size+=chunk.length; requireValue(size<=512*1024*1024,'archive size'); chunks.push(chunk); }
  const bytes=Buffer.concat(chunks);
  requireValue(`sha256:${sha(bytes)}` === expected.digest,'download digest');
  await mkdir(root,{recursive:true});
  const zip=join(root,'../writer-native.zip'); await writeFile(zip,bytes,{flag:'wx'});
  // Validate ALL names/modes before extracting; no archive scripts or links.
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
  const after = await get(`/actions/artifacts/${expected.id}`);
  await writeFile(evidence,JSON.stringify({before,after,expected},null,2));
  assertArtifactMetadata(after,expected);
  requireValue(sha(await readFile(zip)) === expected.digest.slice(7), 'post-download archive digest');
  await assertArtifactDirectory(root,expected);
  await writeFile(join(root,'../artifact-metadata.json'),JSON.stringify({before,after,expected},null,2));
}
if(process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const expected={id:process.env.ARTIFACT_ID,digest:`sha256:${(process.env.ARTIFACT_DIGEST ?? '').replace(/^sha256:/,'')}`,repository:process.env.GITHUB_REPOSITORY,repositoryId:process.env.GITHUB_REPOSITORY_ID,run:process.env.GITHUB_RUN_ID,attempt:process.env.GITHUB_RUN_ATTEMPT,source:process.env.SOURCE_SHA,tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim(),target:process.env.TARGET};
    await download(expected,process.argv[2]);
  } catch(error) {console.error(error.message); process.exitCode=1;}
}
