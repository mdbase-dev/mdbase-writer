import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { originalMembers } from '../scripts/lib/native-originals.mjs';
export const digest=(b,alg='sha256')=>createHash(alg).update(b).digest(alg==='sha512'?'base64':'hex');
export async function trustFixture(target) {
 const repo=await mkdtemp(join(tmpdir(),'writer-originals-')),app=join(repo,'apps/writer'),packet=join(app,`vendor/native-release/${target}`);
 const put=async (path,b)=>{await mkdir(join(path,'..'),{recursive:true});await writeFile(path,b);};
 const obj=async(path,v)=>put(path,JSON.stringify(v));
 const sha='a'.repeat(40),hashes={},archives={};
 const sources=join(repo,'fixtures');
 for(const [key,name] of [['protocol','connect-protocol'],['ui','ui']]) {
  await obj(join(sources,key,'package/package.json'),{name:`@mdbase-dev/${name}`,version:'1.0.0'});
  await put(join(sources,key,'package/index.js'),'export const original=true;');
 }
 const sdk=join(sources,'sdk/package');
 await obj(join(sdk,'package.json'),{name:'@mdbase-dev/sdk',version:'1.0.0'});
 await cp(join(sources,'protocol/package'),join(sdk,'node_modules/@mdbase-dev/connect-protocol'),{recursive:true});
 const trustAsset=Buffer.from('{"signed":"original-target-asset"}');
 const assetHash=digest(trustAsset),cpOrigin=target==='staging'?'https://connect-staging.mdbase.dev':'https://connect.mdbase.dev';
 const source={repository:'mdbase-dev/mdbase-connect',commit:sha,version:'v1'};
 const context={schema_version:1,kind:'mdbase-next-build-trust-context',context:{sha256:assetHash,environment:target,control_plane_origin:cpOrigin,log_origin:'https://log.example',source},provenance:{asset_path:`next-trust/${target}.json`,asset_length:trustAsset.length,proof_sha256:{},image_publication:{run_id:1,run_attempt:1},trust_publication:{run_id:2,run_attempt:1,publisher_commit:sha},publisher_qualification:{run_id:3,run_attempt:1}}};
 const image={...source,publication:{runId:1,runAttempt:1}};
 const imageBytes=JSON.stringify(image);
 const inventory={schemaVersion:1,kind:'mdbase-release-trust-bundle',...source,trustAssets:[{path:`next-trust/${target}.json`,length:trustAsset.length,sha256:assetHash,environment:target,controlPlaneOrigin:cpOrigin,logOrigin:'https://log.example',source}],imageBundle:{path:'image-release-bundle.json',length:Buffer.byteLength(imageBytes),sha256:digest(imageBytes),publicationRunId:1,publicationRunAttempt:1},publication:{runId:2,runAttempt:1,publisherCommit:sha},qualification:{runId:3,runAttempt:1}};
 for(const [filename,bytes] of Object.entries({'release-trust-bundle.json':JSON.stringify(inventory),'release-trust-bundle.sigstore.json':'{}','image-release-bundle.json':imageBytes,'image-release-bundle.sigstore.json':'{}'})) {await put(join(packet,filename),bytes);context.provenance.proof_sha256[filename]=digest(bytes);}
 await obj(join(packet,`next-trust/${target}-context.json`),context);
 await put(join(packet,`next-trust/${target}.json`),trustAsset);
 const contextSha256=digest(JSON.stringify(context)),verifierSha256='b'.repeat(64);
 const receipt={schema:'mdbn-sdk/application-build/1',contextSha256,verifierSha256,verifierSourceCommit:sha};
 await obj(join(packet,'build-receipt.json'),receipt);
 const nativeAssets={};
 for(const name of ['runtime.wasm','sqlite3.wasm','sqlite3.js']) {const bytes=Buffer.from(name);await put(join(sdk,'dist/native',name),bytes);nativeAssets[name]={sha256:digest(bytes),bytes:bytes.length};}
 const provenance={schema:'mdbn-sdk/application-assets/1',environment:target,trust:{environment:target,cpOrigin,logOrigin:'https://log.example',sha256:assetHash,sourceCommit:sha,sourceVersion:'v1'},handoff:{...context.provenance,contextSha256,receiptSha256:digest(JSON.stringify(receipt))},verifier:{sha256:verifierSha256,source:sha,clockOverride:false},runtime:{...nativeAssets['runtime.wasm'],maxBytes:99,source:{repository:source.repository,commit:sha}},sqlite:{...nativeAssets['sqlite3.wasm'],maxBytes:99,initializer:nativeAssets['sqlite3.js']}};
 await obj(join(sdk,'dist/native/provenance.json'),provenance);await obj(join(packet,'provenance.json'),provenance);
 const metadata={schema:'mdbn-app-trust/release/1',environment:target,cpOrigin,logOrigin:'https://log.example',assetSha256:assetHash,source};
 await put(join(sdk,'dist/application/packaged-trust.js'),`const metadata = ${JSON.stringify(metadata)};\n`);
 for(const key of ['sdk','ui','protocol']) {
  const path=`vendor/${key}.tgz`;await mkdir(join(repo,'vendor'),{recursive:true});
  execFileSync('tar',['-czf',join(repo,path),'-C',join(sources,key),'package']);
  const bytes=await readFile(join(repo,path));archives[key]={path,bytes:bytes.length,sha256:digest(bytes),sri:`sha512-${digest(bytes,'sha512')}`,members:originalMembers(join(repo,path)).length};
  hashes[`NATIVE_${key.toUpperCase()}_SHA256`]=digest(bytes);
 }
 hashes.NATIVE_TRUST_ASSET_SHA256=assetHash;
 const dependencies=Object.fromEntries(Object.entries({sdk:'sdk',ui:'ui',protocol:'connect-protocol'}).map(([key,name])=>[`@mdbase-dev/${name}`,`file:../../${archives[key].path}`]));
 await obj(join(app,'package.json'),{dependencies});
 const importer=Object.entries(dependencies).map(([name,pin])=>`      '${name}':\n        specifier: ${pin}\n        version: ${pin}\n`).join('');
 const resolutions=Object.entries({sdk:'sdk',ui:'ui',protocol:'connect-protocol'}).map(([key,name])=>`  '@mdbase-dev/${name}@file:${archives[key].path}':\n    resolution: {integrity: ${archives[key].sri}, tarball: file:${archives[key].path}}\n`).join('');
 await put(join(repo,'pnpm-lock.yaml'),`lockfileVersion: '9.0'\nimporters:\n  apps/writer:\n    dependencies:\n${importer}\npackages:\n${resolutions}`);
 await obj(join(packet,'members.json'),originalMembers(join(repo,archives.sdk.path)));
 const protocol=archives.protocol;
 await obj(join(packet,'artifact-facts.json'),{source:sha,sourceTree:sha,archive:'sdk.tgz',...Object.fromEntries(['bytes','sha256','sri','members'].map(k=>[k,archives.sdk[k]])),nativeSource:sha,nativeSha256:provenance.runtime.sha256,nativeBytes:provenance.runtime.bytes,dependencies:[{name:'@mdbase-dev/connect-protocol',file:'protocol.tgz',bytes:protocol.bytes,sha256:protocol.sha256,sri:protocol.sri}]});
 for(const [key,name] of [['sdk','sdk'],['ui','ui'],['protocol','connect-protocol']]) await cp(join(sources,key,'package'),join(app,'node_modules/@mdbase-dev',name),{recursive:true});
 return {repo,app,packet,hashes,sources};
}
