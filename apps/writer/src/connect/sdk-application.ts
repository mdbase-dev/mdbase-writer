import { MdbaseConnect, type MdbaseApplicationDeclaration } from "@mdbase-dev/sdk";
import manifest from "../generated/mdbase-app.json";

/** App declaration only. The logical manifest ID is not a registration receipt;
 * SDK registration resolves the genuine native binding. An explicit registered
 * ID, when supplied, must match that binding. No app runtime/storage callbacks. */
export function createWriterApplication(input: {
  registeredApplicationId?: string;
  environment: MdbaseApplicationDeclaration["environment"];
}) {
  return new MdbaseConnect({ id: input.registeredApplicationId ?? manifest.id, name: manifest.name,
    origin: new URL(manifest.homepage).origin, environment: input.environment, manifest });
}

/** LAB default only; production waits for its owner-provided trust asset. */
export function writerApplicationForBuild(environment: string | undefined) {
  return environment === "lab" ? createWriterApplication({environment: "lab"}) : undefined;
}
