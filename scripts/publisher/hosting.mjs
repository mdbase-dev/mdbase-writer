// Reuse Writer's static-byte, Functions, R2 and official compiler checks on both origins.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyServedAssets } from '../../apps/writer/scripts/verify-served.mjs';
import { readHostingMetadata, sourceHostingPolicy } from '../lib/writer-hosting-policy.mjs';
export async function verifyPublication(plan,inventory,deployment,artifactRoot,{sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=()=>performance.now()}={}) {
 const repoRoot=process.env.WRITER_SOURCE_ROOT??process.cwd(),policy=await sourceHostingPolicy(repoRoot);
 const metadata=await readHostingMetadata({policy,plan,deployment,accountId:process.env.CLOUDFLARE_ACCOUNT_ID,apiToken:process.env.CLOUDFLARE_API_TOKEN});
 const publication={repoRoot,artifactRoot,plan,deployment,metadata};
 const check=origin=>verifyServedAssets({origin,inventory,publication});
 const immutable=await check(deployment.url);
 if(!immutable.ok)return {...immutable,origins:[{origin:deployment.url,...immutable}]};
 const deadline=now()+300000,attempts=[];let alias;
 do {
  alias=await check(plan.origin);
  attempts.push({ok:alias.ok});
  if(alias.ok)break;
  if(now()+15000>=deadline)break;
  await sleep(15000);
 }while(now()<deadline);
 return {...alias,origins:[{origin:deployment.url,...immutable},{origin:plan.origin,...alias}],aliasAttempts:attempts};
}
try {
 const json=async p=>JSON.parse(await readFile(p,'utf8'));
 const [plan,inventory,deployment,artifact]=process.argv.slice(2);
 const result=await verifyPublication(await json(plan),await json(inventory),await json(deployment),resolve(artifact));
 console.log(JSON.stringify(result,null,2));if(!result.ok)process.exitCode=1;
}catch{console.log(JSON.stringify({ok:false,reason:'hosting-verification-failed'}));process.exitCode=1;}
