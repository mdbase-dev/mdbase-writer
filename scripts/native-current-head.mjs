// Last step before upload, independent of fetched/local refs. No approval API.
import { fileURLToPath } from 'node:url';
import { assertDispatch, assertFullSha } from '../apps/writer/scripts/native-publisher.mjs';
export async function assertCurrentHead(env=process.env,transport=fetch) {
 const sha=assertFullSha(env.SOURCE_SHA),target=env.TARGET;
 assertDispatch({target,sha,eventName:env.GITHUB_EVENT_NAME,ref:env.GITHUB_REF,workflowSha:env.GITHUB_SHA});
 const response=await transport(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/git/ref/heads/release/native-${target}`,{
  redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json'},
 });
 if(!response.ok) throw Error('Current protected native HEAD unavailable; refusing upload');
 const ref=await response.json();
 if(ref.ref !== `refs/heads/release/native-${target}` || ref.object?.type !== 'commit' || ref.object.sha !== sha) throw Error('Current native HEAD moved; refusing upload');
}
if(process.argv[1]===fileURLToPath(import.meta.url)) await assertCurrentHead();
