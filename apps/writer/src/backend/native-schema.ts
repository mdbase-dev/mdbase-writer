import { toPlain, type wire } from "@mdbase-dev/sdk";
import type { JsonObject } from "./types.js";
import manifest from "../generated/mdbase-app.json";
import { annotationContract, CollectionSchema, domainContract, unavailableTypeMessage, type Domain, type WriterSchemaDescription } from "./collection.js";
import type { UnavailableType } from "./types.js";

const DOMAINS: readonly Domain[] = ["manuscript", "source", "annotation", "comment", "person"];
const domainOf = (id: string): Domain | undefined => DOMAINS.find(domain => domainContract(domain).id === id);
/** The definition path an issue is attached to, when it names one. */
function issuePath(details: unknown): string | null {
  const path = details instanceof Map ? (details as Map<unknown, unknown>).get("path") : null;
  return typeof path === "string" && path ? path : null;
}

export type NativeJson = null | boolean | number | string | NativeJson[] | { [key: string]: NativeJson };
/** Application JSON display values only. Native witnesses stay in SDK RecordViews. */
export function nativeJson(value: unknown): NativeJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(nativeJson);
  if (typeof value === "object" && value !== null && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, nativeJson(item)]));
  }
  throw new Error("Writer requires JSON-compatible native fields.");
}
export function nativeWriteFields(fields: JsonObject): { [key: string]: NativeJson } {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, nativeJson(value)]));
}
export function nativeObject(value: wire.Value): JsonObject {
  const json = nativeJson(toPlain(value));
  if (json === null || typeof json !== "object" || Array.isArray(json)) throw new Error("Writer requires a native field map.");
  return json;
}

/** The wire reports contract digests as `sha256:<hex>` (as the manifest does).
 * Compare in that canonical form so neither side's spelling can mismatch. */
export function sameDigest(a: string | undefined, b: string | undefined): boolean {
  const canonical = (digest: string) => digest.startsWith("sha256:") ? digest : `sha256:${digest}`;
  return a !== undefined && b !== undefined && canonical(a) === canonical(b);
}

export function manifestContractDigest(id: string, version: string): string | undefined {
  return manifest.requirements.contracts.find(contract => contract.id === id && contract.version === version)?.digest;
}

/** Read the original native catalog. Never invent legacy schema/type metadata or
 * recognise a starter name without its actual native contract implementation.
 * The SDK remains responsible for root readiness and configuration/provisioning.
 */
export function nativeWriterSchema(catalog: wire.DescribeResult): CollectionSchema {
  // Aggregate readiness belongs to the SDK. An unrelated definition diagnostic
  // must not hide usable Writer records; exact domain bindings remain checked.
  const required = manifest.requirements.contracts;
  for (const expected of required) {
    const matching = catalog.contracts.filter(contract => contract.id === expected.id && contract.version === expected.version);
    const actual = matching[0];
    if (matching.length !== 1 || !actual || actual.contractType !== "record" || !sameDigest(actual.digest, expected.digest)) {
      throw new Error("This collection does not have Writer's exact native contracts.");
    }
  }
  const supported = new Map([...required.map(contract => [contract.id, contract.version] as const),
    [annotationContract.id, annotationContract.version], ["mdbase.person", "2.0.0"]]);
  // An error-level issue on one of Writer's own type definitions makes only
  // that type unavailable. Issues elsewhere never hide Writer's records.
  const broken = new Set(catalog.issues.filter(issue => issue.severity === "error").map(issue => issuePath(issue.details)).filter(path => path !== null));
  const unavailableTypes: (UnavailableType & {domain: Domain})[] = [];
  const contracts: WriterSchemaDescription["contracts"] = catalog.contracts
    .filter(contract => supported.get(contract.id) === contract.version && contract.contractType === "record")
    .map(contract => ({id: contract.id, implementations: contract.implementedBy.flatMap(name => {
      const type = catalog.types.find(candidate => candidate.name === name);
      const bindings = type?.implements.filter(binding => binding.contract === contract.id && binding.version === contract.version) ?? [];
      const binding = bindings[0];
      if (!type || bindings.length !== 1 || !binding) throw new Error("Writer's native contract binding is incomplete.");
      if (broken.has(type.path)) {
        const domain = domainOf(contract.id);
        if (domain && !unavailableTypes.some(entry => entry.name === type.name)) unavailableTypes.push({name: type.name, domain, message: unavailableTypeMessage(type.name, domain)});
        return [];
      }
      return [{typeName: type.name, fields: Object.fromEntries(binding.fields)}];
    })}));
  const schema = new CollectionSchema({types: catalog.types.map(type => ({name: type.name})), contracts,
    // A collection without settings reports null: that is no settings, not an error.
    configuration: {settings: catalog.settings === null ? {} : nativeObject(catalog.settings)}, unavailableTypes});
  const manuscripts = schema.bindings("manuscript", true);
  if (!manuscripts.ok && !schema.unavailableMessage("manuscript")) throw new Error(manuscripts.message);
  return schema;
}
