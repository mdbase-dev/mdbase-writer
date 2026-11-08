// Derive the staging install from the authenticated plan, never repack the SDK.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archiveBytes } from './authentication.mjs';
export async function prepareInstall(plan,root=process.cwd(),fetchImpl=fetch) {
 if(plan.target==='production')return;
 if(plan.target!=='staging')throw Error('Unknown install target');
 const archive=plan.sdkTrust.archives.sdk;
 const bytes=await archiveBytes(archive.path,fetchImpl);
 if(createHash('sha256').update(bytes).digest('hex')!==archive.sha256)throw Error('Staging install archive mismatch');
 const path='vendor/sdk-staging.tgz';
 await writeFile(join(root,path),bytes);
 const manifestPath=join(root,'apps/writer/package.json');
 const pkg=JSON.parse(await readFile(manifestPath,'utf8'));
 if(pkg.dependencies['@mdbase-dev/sdk']!==plan.sdkTrust.production.version)throw Error('Production install pin changed');
 pkg.dependencies['@mdbase-dev/sdk']='file:../../vendor/sdk-staging.tgz';
 await writeFile(manifestPath,JSON.stringify(pkg,null,2)+'\n');
 const lockPath=join(root,'pnpm-lock.yaml');
 const lock=await readFile(lockPath,'utf8');
 if(createHash('sha256').update(lock).digest('hex')!==plan.sdkTrust.lockSha256)throw Error('Source lock changed');
 const stagingPath='file:vendor/sdk-staging.tgz';
 const alias='@mdbase-dev/sdk-staging@'+stagingPath;
 // pnpm's file alias must name the actual archive package, including UI peers.
 // Keep the application import name @mdbase-dev/sdk, not the production identity.
 const version=plan.sdkTrust.production.version;
 const importer=`'@mdbase-dev/sdk':\n        specifier: ${version}\n        version: ${version}\n`;
 if(!lock.includes(importer))throw Error('Production frozen importer changed');
 const staged=lock.replace(importer,`'@mdbase-dev/sdk':\n        specifier: file:../../vendor/sdk-staging.tgz\n        version: '${alias}'\n`)
  .replaceAll(`@mdbase-dev/sdk@${version}`,alias)
  .replace(`resolution: {integrity: ${plan.sdkTrust.production.sri}}`,
   `resolution: {integrity: ${archive.sri}, tarball: ${stagingPath}}\n    name: '@mdbase-dev/sdk-staging'\n    version: ${version}`)
  .replaceAll(`'@mdbase-dev/sdk': ${version}`,`'@mdbase-dev/sdk': '${alias}'`);
 await writeFile(lockPath,staged);
}
if(process.argv[1]===fileURLToPath(import.meta.url))await prepareInstall(JSON.parse(await readFile(process.argv[2],'utf8')));
