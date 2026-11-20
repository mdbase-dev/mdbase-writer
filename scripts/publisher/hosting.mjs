// Reuse Writer's static-byte, Functions, R2 and official compiler checks on both origins.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyServedAssets } from '../../apps/writer/scripts/verify-served.mjs';
import { readHostingMetadata, sourceHostingPolicy } from '../lib/writer-hosting-policy.mjs';
async function pollOrigin(check,origin,windowMs,intervalMs,sleep,now) {
 const deadline=now()+windowMs,attempts=[];let result;
 do {
  result=await check(origin);
  attempts.push({ok:result.ok});
  if(result.ok)break;
  if(now()+intervalMs>=deadline)break;
  await sleep(intervalMs);
 }while(now()<deadline);
 return {result,attempts};
}
export async function verifyPublication(plan,inventory,deployment,artifactRoot,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>performance.now(),immutableWindowMs=90000,immutableIntervalMs=10000,aliasWindowMs=300000,aliasIntervalMs=15000,verify=verifyServedAssets,readMetadata=readHostingMetadata}={}) {
 const repoRoot=process.env.WRITER_SOURCE_ROOT??process.cwd(),policy=await sourceHostingPolicy(repoRoot);
 const metadata=await readMetadata({policy,plan,deployment,accountId:process.env.CLOUDFLARE_ACCOUNT_ID,apiToken:process.env.CLOUDFLARE_API_TOKEN});
 const publication={repoRoot,artifactRoot,plan,deployment,metadata};
 const check=origin=>verify({origin,inventory,publication});
 const {result:immutable,attempts:immutableAttempts}=await pollOrigin(check,deployment.url,immutableWindowMs,immutableIntervalMs,sleep,now);
 if(!immutable.ok)return {...immutable,origins:[{origin:deployment.url,...immutable}],immutableAttempts};
 const {result:alias,attempts:aliasAttempts}=await pollOrigin(check,plan.origin,aliasWindowMs,aliasIntervalMs,sleep,now);
 return {...alias,origins:[{origin:deployment.url,...immutable},{origin:plan.origin,...alias}],immutableAttempts,aliasAttempts};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
 try {
  const json=async p=>JSON.parse(await readFile(p,'utf8'));
  const [plan,inventory,deployment,artifact]=process.argv.slice(2);
  const result=await verifyPublication(await json(plan),await json(inventory),await json(deployment),resolve(artifact));
  console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
 }catch{console.log(JSON.stringify({ok:false,reason:'hosting-verification-failed'}));process.exitCode=1;}
}
