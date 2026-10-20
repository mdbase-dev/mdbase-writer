// Offline compiler compatibility only; never deploy, no Cloudflare credentials.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const repo=resolve('.'),root=await mkdtemp(join(repo,'.publisher-tools-'));
const env={...process.env,NPM_CONFIG_USERCONFIG:'/dev/null',NPM_CONFIG_GLOBALCONFIG:'/dev/null',WRANGLER_SEND_METRICS:'false'};
delete env.CLOUDFLARE_API_TOKEN;delete env.CLOUDFLARE_ACCOUNT_ID;
try {
 for(const name of ['package.json','pnpm-lock.yaml']) await cp(join(repo,'tools/native-publisher',name),join(root,name));
 execFileSync('pnpm',['--ignore-workspace','install','--frozen-lockfile','--ignore-scripts','--ignore-pnpmfile'],{cwd:root,env,stdio:'inherit'});
 assert.equal(JSON.parse(await readFile(join(root,'node_modules/wrangler/package.json'))).version,'4.114.0');
 execFileSync(join(root,'node_modules/.bin/wrangler'),['pages','functions','build',join(repo,'apps/writer/functions'),'--outfile',join(root,'_worker.js')],{cwd:root,env,stdio:'inherit'});
 const worker=await readFile(join(root,'_worker.js'),'utf8');
 assert.ok(worker.includes('WRITER_ASSETS') && worker.includes('application/wasm'));
 console.log('PASS isolated integrity-locked Wrangler 4.114.0 --ignore-scripts + Pages Functions precompile (NO deploy)');
} finally {await rm(root,{recursive:true,force:true});}
