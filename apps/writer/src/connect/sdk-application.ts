import { createMdbase, type Mdbase, type MdbaseApplicationDeclaration } from "@mdbase-dev/sdk";
import manifest from "../generated/mdbase-app.json";

/** App declaration only. The logical manifest ID is not a registration receipt;
 * SDK registration resolves the genuine native binding. An explicit registered
 * ID, when supplied, must match that binding. No app runtime/storage callbacks. */
export function createWriterMdbase(input: {
  registeredApplicationId?: string;
  environment: MdbaseApplicationDeclaration["environment"];
}): Mdbase {
  return createMdbase({ id: input.registeredApplicationId ?? manifest.id, name: manifest.name,
    origin: new URL(manifest.homepage).origin, environment: input.environment, manifest },
  {readiness: {typeIssues: "degrade"}});
}

/** LAB default only; production waits for its owner-provided trust asset. */
export function writerMdbaseForBuild(environment: string | undefined): Mdbase | undefined {
  return environment === "lab" ? createWriterMdbase({environment: "lab"}) : undefined;
}
