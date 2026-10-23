import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const root=resolve('.');
const read=path=>readFile(resolve(root,path));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const metadata=bytes=>JSON.parse(/^const metadata = (\{.*\});$/m.exec(bytes.toString())[1]);
const member=(archive,path)=>execFileSync('tar',['-xOf',resolve(root,'vendor',archive),`package/dist/${path}`],{maxBuffer:8_000_000});

test('production archive matches TaskNotes; installed SDK matches the explicit target',async()=>{
 const pin=JSON.parse(await read('vendor/sdk-production-beta141.json'));
 assert.equal(pin.sha256,'e64771a90bed2fb3837d4b65df8930fcd124d3059fcb0bcbaf9d64dbfb148205');
 assert.equal(pin.sourceCommit,'eaa4e697fc1198f32fc3714f377342a24c56d985');
 assert.equal(hash(await read(`vendor/${pin.artifact}`)),pin.sha256);
 const pkg=JSON.parse(await read('apps/writer/package.json'));
 const target=process.env.VITE_MDBASE_ENV==='staging'?'staging':'production';
 const archive=target==='staging'?'sdk-dev-eaa4e697-staging.tgz':pin.artifact;
 assert.equal(pkg.dependencies['@mdbase-dev/sdk'],`file:../../vendor/${archive}`);
 const original=member(pin.artifact,'application/packaged-trust.js');
 assert.equal(hash(original),pin.packagedTrustModuleSha256);
 assert.deepEqual(await read('apps/writer/node_modules/@mdbase-dev/sdk/dist/application/packaged-trust.js'),member(archive,'application/packaged-trust.js'));
 const release=metadata(original);
 assert.equal(release.environment,'production');
 assert.equal(release.cpOrigin,'https://connect.mdbase.dev');
 assert.equal(release.logOrigin,'https://log.mdbase.dev');
 assert.equal(release.assetSha256,'7912e40838213e60b65848350d319a48019021317b112e3326429b250f0133d7');
 const sdk=path=>'apps/writer/node_modules/@mdbase-dev/sdk/dist/'+path;
 const {appReleaseTrust}=await import(pathToFileURL(resolve(root,sdk('application/packaged-trust.js'))));
 const {selectAppEnvironment}=await import(pathToFileURL(resolve(root,sdk('app-host/app-environment.js'))));
 const selectedRelease=appReleaseTrust();
 const input={environment:target,appOrigin:target==='staging'?'https://staging.mdbase-writer.pages.dev':'https://writer.mdbase.dev',release:selectedRelease};
 assert.equal(selectAppEnvironment(input).cpOrigin,selectedRelease.cpOrigin);
 assert.throws(()=>selectAppEnvironment({...input,environment:target==='staging'?'production':'staging'}));
});

test('retained staging dependency and trust are unchanged, not retargeted production',async()=>{
 const pkg=JSON.parse(await read('tests/fixtures/staging-package.snapshot'));
 assert.equal(pkg.dependencies['@mdbase-dev/sdk'],'file:../../vendor/sdk-dev-eaa4e697-staging.tgz');
 assert.equal(hash(await read('vendor/sdk-dev-eaa4e697-staging.tgz')),'15eb64b50fc7c2809ff3dba9cce5104fe48d8592208b3af8acb529862a1af18c');
 const release=metadata(member('sdk-dev-eaa4e697-staging.tgz','application/packaged-trust.js'));
 assert.equal(release.environment,'staging');
 assert.equal(release.cpOrigin,'https://connect-staging.mdbase.dev');
 assert.equal(release.logOrigin,'https://log-staging.mdbase.dev');
 assert.equal(release.assetSha256,'67e117646c9c26927f0d5a44cbd26f057c318975032e9cd24f24b020150cdbc7');
});
