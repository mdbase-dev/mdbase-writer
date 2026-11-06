// Credential-free build rehearsal, never admission, upload or deployment.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOriginals } from './originals.mjs';
import { deploymentFor } from './refs.mjs';
import { prepareInstall } from './install-inputs.mjs';
import { assertArtifactDirectory } from './artifact.mjs';
const [target,sha]=process.argv.slice(2),root=process.cwd();
if(!/^[a-f0-9]{40}$/.test(sha??''))throw Error('Full rehearsal source required');
const destination=deploymentFor(target);
const publication=JSON.parse(await readFile('config/sdk-publication.json','utf8')).sdkPublication;
const plan={sha,target,tree:'0'.repeat(40),origin:destination.origin,pagesBranch:destination.branch,
 sdkTrust:await loadOriginals({target,repoRoot:root,hashes:{WRITER_TRUST_ASSET_SHA256:publication.environments[target].sha256}})};
const directory=await mkdtemp(join(tmpdir(),'writer-build-rehearsal-'));
const tools=await mkdtemp(join(tmpdir(),'writer-tools-rehearsal-'));
const pkg=await readFile('apps/writer/package.json'),lock=await readFile('pnpm-lock.yaml');
try {
 await writeFile(join(directory,'plan.json'),JSON.stringify(plan,null,2)+'\n');
 await prepareInstall(plan,root);
 execFileSync('pnpm',['install','--frozen-lockfile','--ignore-scripts','--ignore-pnpmfile'],{stdio:'inherit'});
 execFileSync(process.execPath,[fileURLToPath(new URL('./build.mjs',import.meta.url)),directory],{stdio:'inherit',env:{...process.env,
  RUNNER_TEMP:tools,VITE_MDBASE_FEEDBACK_URL:target==='production'?'https://feedback-api.mdbase.dev/v1/feedback':'https://feedback-api-staging.mdbase.dev/v1/feedback',
  VITE_MDBASE_TURNSTILE_SITE_KEY:target==='production'?'0x4AAAAAAEboz_mLT-taI3H-':'0x4AAAAAAEbkvA4d9vQJq2D1'}});
 const binding={repository:'mdbase-dev/mdbase-writer',run:'1',attempt:'1',event:'workflow_dispatch',ref:'refs/heads/main',workflowSha:sha,source:sha,tree:plan.tree,target};
 execFileSync(process.execPath,[fileURLToPath(new URL('./envelope.mjs',import.meta.url)),directory],{env:{...process.env,
  GITHUB_REPOSITORY:binding.repository,GITHUB_RUN_ID:binding.run,GITHUB_RUN_ATTEMPT:binding.attempt,
  GITHUB_EVENT_NAME:binding.event,GITHUB_REF:binding.ref,GITHUB_SHA:binding.workflowSha}});
 await assertArtifactDirectory(directory,binding);
 console.log('Writer authenticated build and artifact rehearsal passed (no deployment)');
}finally{
 await writeFile('apps/writer/package.json',pkg);await writeFile('pnpm-lock.yaml',lock);
 if(target==='staging')await rm('vendor/sdk-staging.tgz',{force:true});
 await rm(directory,{recursive:true,force:true});await rm(tools,{recursive:true,force:true});
}
