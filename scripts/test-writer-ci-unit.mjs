// SYNTHETIC UNIT DATA ONLY: reproduce unprivileged CI's public ambient inputs.
// Not a GitHub run, qualification identity, protected-variable fallback or GO.
// Explicitly allow tests/checks only: NEVER app/Functions/SDK builds or network.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { normalizeWriterInstaller } from './lib/writer-installer.mjs';
import { loadOriginals,protectedHashes } from './lib/native-originals.mjs';
const scripts={publisher:'test:publisher',check:'check'},mode=process.argv[2];
assert.ok(Object.hasOwn(scripts,mode),'Explicit publisher/check UNIT mode required; no build mode');
for(const name of ['CLOUDFLARE_API_TOKEN','CLOUDFLARE_TOKEN','CLOUDFLARE_ACCOUNT_ID','GITHUB_TOKEN','GH_TOKEN'])assert.ok(!process.env[name],'No private credentials allowed in synthetic unit runner');
const config=JSON.parse(await readFile('config/native-publish/production.json','utf8'));
const pins=protectedHashes(config.protectedHashes);
// Same original/install guards as ordinary source qualification, BEFORE tests
// that can import candidate SDK. The pins are already approved public INPUTS,
// never derived from a candidate, authenticated here or changed by this runner.
const options={repoRoot:resolve('.'),target:'production',hashes:pins};
await normalizeWriterInstaller(options);
const originals=await loadOriginals({...options,installed:true});
const installedOriginals={sdk:originals.archives.sdk.members,ui:originals.archives.ui.version,protocol:originals.archives.protocol.members};
// loadOriginals already binds complete inventories to approved producer facts;
// do not hard-code member counts that change during a mechanical SDK repin.
console.log(JSON.stringify({kind:'SYNTHETIC-UNIT-DATA-NOT-actual-CI-or-publication',GITHUB_ACTIONS:'true',publicHashInputs:'four approved production inputs',installedOriginals,mode,publication:false,admission:false}));
// No fabricated GitHub source/ref/run/repository identity. Existing unit fixture
// subprocesses retain their explicitly synthetic isolated source/event inputs.
execFileSync('pnpm',['run',scripts[mode]],{stdio:'inherit',env:{...process.env,...pins,GITHUB_ACTIONS:'true',TARGET:'production'}});
