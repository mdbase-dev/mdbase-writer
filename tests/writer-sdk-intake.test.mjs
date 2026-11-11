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

test('production npm archive and installed SDK match the authenticated release',async()=>{
 const pin=JSON.parse(await read('vendor/sdk-production-beta183.json'));
 assert.equal(pin.sha256,'566d7d0d8183bf9d4db2d576787ca737aa3b4c034c119e41b11240290407f787');
 assert.equal(pin.sourceCommit,'0d79b57ffcf71b7e9d144649ae80e088190a615b');
 assert.equal(hash(await read(`vendor/${pin.artifact}`)),pin.sha256);
 const pkg=JSON.parse(await read('apps/writer/package.json'));
 const target=process.env.VITE_MDBASE_ENV==='staging'?'staging':'production';
 const archive=pin.artifact;
 assert.equal(pkg.dependencies['@mdbase-dev/sdk'],'0.1.0-beta.183');
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
