import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { assertCompiledRelease } from '../scripts/lib/writer-compiled-trust.mjs';
const release={schema:'mdbn-app-trust/release/1',environment:'staging',cpOrigin:'https://connect-staging.mdbase.dev',logOrigin:'https://log-staging.mdbase.dev',assetSha256:'a'.repeat(64),source:{commit:'b'.repeat(40)}};
const root='c'.repeat(64),pins='d'.repeat(248),moduleBytes=Buffer.from('const rootHex = Object.freeze('+JSON.stringify([root])+');\nconst pinsHex = "'+pins+'";\n');
const sdkTrust={release,trustModuleSha256:createHash('sha256').update(moduleBytes).digest('hex')};
const fixture=()=>({compiled:{...release,trustedRoots:[Uint8Array.from(Buffer.from(root,'hex'))],policyPins:Uint8Array.from(Buffer.from(pins,'hex'))},moduleBytes,sdkTrust});
test('actual enriched public shape binds metadata PLUS every original root/policy pin',()=>{assert.equal(assertCompiledRelease(fixture()).policyPinsBytes,124);});
for(const kind of ['metadata','roots','pins','extra','module'])test('compiled '+kind+' substitution refuses',()=>{
 const f=fixture();if(kind==='metadata')f.compiled.environment='lab';if(kind==='roots')f.compiled.trustedRoots[0][0]^=1;if(kind==='pins')f.compiled.policyPins[0]^=1;if(kind==='extra')f.compiled.unknown=true;if(kind==='module')f.moduleBytes=Buffer.from('replacement');assert.throws(()=>assertCompiledRelease(f),/Compiled release refusal/);
});
