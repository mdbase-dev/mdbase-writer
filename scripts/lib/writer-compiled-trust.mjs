// Actual public SDK return-shape check AFTER complete original/installed gates.
// Module literals are parsed AS DATA, never eval; no SDK authority is invented.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function assertCompiledRelease({compiled,moduleBytes,sdkTrust}){
 const fail=reason=>{throw Error('Compiled release refusal: '+reason);};
 if(hash(moduleBytes)!==sdkTrust.trustModuleSha256)fail('independently bound original module bytes');
 const source=moduleBytes.toString('utf8'),roots=/const rootHex = Object\.freeze\((\[[^\n]*\])\);/.exec(source),pins=/const pinsHex = "([a-f0-9]+)";/.exec(source);
 if(!roots||!pins)fail('canonical original public material literals');
 let expectedRoots;try{expectedRoots=JSON.parse(roots[1]);}catch{fail('root literal JSON');}
 if(!Array.isArray(expectedRoots)||expectedRoots.length===0||expectedRoots.some(x=>!/^[a-f0-9]{64}$/.test(x))||pins[1].length%2)fail('original public material encoding');
 const expected=sdkTrust.release,keys=Object.keys(expected);
 if(!compiled||!isDeepStrictEqual(Object.keys(compiled).sort(),[...keys,'trustedRoots','policyPins'].sort()))fail('actual public return fields');
 if(!isDeepStrictEqual(Object.fromEntries(keys.map(k=>[k,compiled[k]])),expected))fail('exact environment/CP/log/asset/source metadata');
 if(!Array.isArray(compiled.trustedRoots)||compiled.trustedRoots.some(v=>!(v instanceof Uint8Array))||!isDeepStrictEqual(compiled.trustedRoots.map(v=>Buffer.from(v).toString('hex')),expectedRoots))fail('ALL original trusted root bytes');
 if(!(compiled.policyPins instanceof Uint8Array)||Buffer.from(compiled.policyPins).toString('hex')!==pins[1])fail('exact original policy pins');
 return {release:expected,trustedRootCount:expectedRoots.length,policyPinsBytes:compiled.policyPins.length,policyPinsSha256:hash(compiled.policyPins)};
}
