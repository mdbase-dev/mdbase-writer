// No environment or deployment credentials. Originals are compared before execution.
import { execFileSync } from 'node:child_process';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareInstalled } from './originals.mjs';
import { publicationInventory, serializeInventory } from './publisher.mjs';
import { prepareRuntimeOriginals } from '../lib/writer-runtime-originals.mjs';
const output=resolve(process.argv[2]),plan=JSON.parse(await readFile(join(output,'plan.json'),'utf8'));
await compareInstalled(process.cwd(),plan.sdkTrust.archives);
const env={...process.env,MDBASE_ENV:plan.target,VITE_MDBASE_ENV:plan.target,
 MDBASE_WRITER_ORIGIN:plan.origin,VITE_MDBASE_EDITOR_URL:plan.target==='production'?'https://editor.mdbase.dev':'https://editor-staging.mdbase.dev',
 MDBASE_CONNECT_URL:plan.sdkTrust.release.cpOrigin,VITE_MDBASE_WRITER_BUILD_ID:plan.sha,
 WRITER_PUBLICATION_PLAN:join(output,'plan.json'),VITE_WRITER_DEMO:'0'};
const run=(command,args)=>execFileSync(command,args,{stdio:'inherit',env});
run('pnpm',['rebuild','--pending']);
run('pnpm',['build']);
const toolPath=join(process.env.RUNNER_TEMP,'writer-build-tool-path');
run(process.execPath,[fileURLToPath(new URL('./tool.mjs',import.meta.url)),toolPath]);
const cli=(await readFile(toolPath,'utf8')).trim();
run(process.execPath,[cli,'pages','functions','build','apps/writer/functions','--outdir','apps/writer/dist/_worker.js']);
await cp('apps/writer/dist',join(output,'publish'),{recursive:true,errorOnExist:true,force:false});
await prepareRuntimeOriginals(process.cwd(),output);
await writeFile(join(output,'inventory.json'),serializeInventory(await publicationInventory(join(output,'publish'),plan)));
