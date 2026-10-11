import { toPlain, type wire } from "@mdbase-dev/sdk";
import type { JsonObject } from "@mdbase-dev/connect";
import manifest from "../generated/mdbase-app.json";
import { annotationContract, CollectionSchema, type WriterSchemaDescription } from "./collection.js";

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

export function manifestContractDigest(id: string, version: string): string | undefined {
  return manifest.requirements.contracts.find(contract => contract.id === id && contract.version === version)?.digest;
}

/** Read the original native catalog. Never invent legacy schema/type metadata or
 * recognise a starter name without its actual native contract implementation.
 * The SDK remains responsible for root readiness and configuration/provisioning.
 */
export function nativeWriterSchema(catalog: wire.DescribeResult): CollectionSchema {
  if (catalog.issues.some(issue => issue.severity === "error")) throw new Error("Writer definitions need attention.");
  const required = manifest.requirements.contracts;
  for (const expected of required) {
    const matching = catalog.contracts.filter(contract => contract.id === expected.id && contract.version === expected.version);
    const actual = matching[0];
    if (matching.length !== 1 || !actual || actual.contractType !== "record" || actual.digest !== expected.digest.replace(/^sha256:/, "")) {
      throw new Error("This collection does not have Writer's exact native contracts.");
    }
  }
  const supported = new Map([...required.map(contract => [contract.id, contract.version] as const),
    [annotationContract.id, annotationContract.version], ["mdbase.person", "2.0.0"]]);
  const contracts: WriterSchemaDescription["contracts"] = catalog.contracts
    .filter(contract => supported.get(contract.id) === contract.version && contract.contractType === "record")
    .map(contract => ({id: contract.id, implementations: contract.implementedBy.map(name => {
      const type = catalog.types.find(candidate => candidate.name === name);
      const bindings = type?.implements.filter(binding => binding.contract === contract.id && binding.version === contract.version) ?? [];
      const binding = bindings[0];
      if (!type || bindings.length !== 1 || !binding) throw new Error("Writer's native contract binding is incomplete.");
      return {typeName: type.name, fields: Object.fromEntries(binding.fields)};
    })}));
  const schema = new CollectionSchema({types: catalog.types.map(type => ({name: type.name})), contracts,
    configuration: {settings: nativeObject(catalog.settings)}}, false);
  const manuscripts = schema.bindings("manuscript", true);
  if (!manuscripts.ok) throw new Error(manuscripts.message);
  return schema;
}
