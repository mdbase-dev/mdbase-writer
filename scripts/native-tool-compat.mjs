// SYNTHETIC Functions compatibility only; never app/SDK build or deployment.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { sourceHostingPolicy, uploadConfiguration } from './lib/writer-hosting-policy.mjs';
import { resolve, join } from 'node:path';
const repo=resolve('.'),root=await mkdtemp(join(repo,'.publisher-tools-'));
const env={...process.env,NPM_CONFIG_USERCONFIG:'/dev/null',NPM_CONFIG_GLOBALCONFIG:'/dev/null',WRANGLER_SEND_METRICS:'false'};
delete env.CLOUDFLARE_API_TOKEN;delete env.CLOUDFLARE_ACCOUNT_ID;
try {
 for(const name of ['package.json','pnpm-lock.yaml']) await cp(join(repo,'tools/native-publisher',name),join(root,name));
 execFileSync('pnpm',['--ignore-workspace','install','--frozen-lockfile','--ignore-scripts','--ignore-pnpmfile'],{cwd:root,env,stdio:'inherit'});
 assert.equal(JSON.parse(await readFile(join(root,'node_modules/wrangler/package.json'))).version,'4.114.0');
 const policy=await sourceHostingPolicy(repo),config=join(root,'wrangler.json');
 await writeFile(config,JSON.stringify(uploadConfiguration(policy)));
 const {unstable_readConfig}=createRequire(join(root,'package.json'))('wrangler');
 for(const environment of ['preview','production']) {
  const parsed=unstable_readConfig({config,env:environment});
  assert.deepEqual(parsed.r2_buckets,policy.r2_buckets);
  assert.equal(parsed.compatibility_date,policy.compatibility_date);
  assert.deepEqual(parsed.compatibility_flags,[]);
 }
 console.log('PASS Wrangler4.114 documented config parser: isolated SOURCE binding/date in both Pages channels');
 // Exercise the SAME output mode selected by the real build workflow, but with
 // a tiny non-product fixture. Parse only; NEVER execute its generated Worker.
 const workflow=await readFile(join(repo,'.github/workflows/deploy-writer.yml'),'utf8');
 const flag=workflow.match(/pages functions build apps\/writer\/functions (--out(?:file|dir)) apps\/writer\/dist\/_worker\.js/)[1];
 const functions=join(root,'synthetic-functions'),output=join(root,'_worker.js');
 await mkdir(functions);
 await writeFile(join(functions,'index.js'),'export const onRequestGet = ({env}) => new Response("SYNTHETIC_WRITER_FUNCTIONS", {headers:{"Content-Type":"application/wasm","X-Synthetic-Binding":typeof env.WRITER_ASSETS}});');
 execFileSync(join(root,'node_modules/.bin/wrangler'),['pages','functions','build','--help'],{cwd:root,env,stdio:'inherit'});
 execFileSync(join(root,'node_modules/.bin/wrangler'),['pages','functions','build',functions,flag,output],{cwd:root,env,stdio:'inherit'});
 const directory=(await stat(output)).isDirectory();
 const worker=await readFile(directory?join(output,'index.js'):output,'utf8');
 const syntax=spawnSync(process.execPath,['--input-type=module','--check'],{input:worker,env,encoding:'utf8'});
 console.log(JSON.stringify({kind:'SYNTHETIC UNIT DATA ONLY',officialWrangler:'4.114.0',flag,directory,multipartMetadata:worker.includes('Content-Disposition: form-data; name="metadata"'),moduleSyntaxExit:syntax.status}));
 assert.equal(syntax.status,0,'compiled output must be JavaScript, NOT a multipart upload body');
 assert.ok(directory,'official advanced-mode _worker.js/index.js layout');
 assert.ok(worker.includes('SYNTHETIC_WRITER_FUNCTIONS') && worker.includes('WRITER_ASSETS') && worker.includes('application/wasm'));
 console.log('PASS official advanced-mode JavaScript from SYNTHETIC Functions; NO product build/deploy');
} finally {await rm(root,{recursive:true,force:true});}
