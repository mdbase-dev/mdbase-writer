// Workflow source entry points only; never invoked for live operations in tests.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { sourceHostingPolicy, uploadConfiguration, readHostingMetadata } from './lib/writer-hosting-policy.mjs';
import { prepareRuntimeOriginals } from './lib/writer-runtime-originals.mjs';
const [command,root,planPath,deploymentPath,preflightPath]=process.argv.slice(2);
try {
 if(command==='prepare-runtime') await prepareRuntimeOriginals(resolve('.'),resolve(root));
 else {
  const policy=await sourceHostingPolicy(resolve('.'));
  if(command==='upload-config'){
   await mkdir(root,{recursive:true});await writeFile(join(root,'wrangler.json'),JSON.stringify(uploadConfiguration(policy),null,2),{flag:'wx'});
  }else if(command==='metadata'){
   const json=async path=>JSON.parse(await readFile(path,'utf8'));
   const plan=await json(planPath),deployment=deploymentPath?await json(deploymentPath):undefined,preflight=preflightPath?await json(preflightPath):undefined;
   const metadata=await readHostingMetadata({policy,plan,deployment,preflight,accountId:process.env.CLOUDFLARE_ACCOUNT_ID,apiToken:process.env.CLOUDFLARE_API_TOKEN});
   await writeFile(root,JSON.stringify(metadata,null,2));
  }else throw Error('unknown command');
 }
}catch(error){
 if(command==='metadata'&&error.safeEvidence)await writeFile(root,JSON.stringify({...error.safeEvidence,failure:'trusted hosting metadata refused'},null,2));
 console.error('Writer trusted runtime/config/metadata intake refused (no payload logged)');process.exitCode=1;
}
