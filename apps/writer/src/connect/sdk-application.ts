import { MdbaseConnect, type MdbaseApplicationDeclaration } from "@mdbase-dev/sdk";
import manifest from "../generated/mdbase-app.json";

/** App declaration only; ID must be the actual registered native binding.
 * Collection selection and its URL are entirely SDK-owned. No local storage,
 * Worker/SQL/trust callbacks or prototype namespace overrides are supplied. */
export function createWriterApplication(input: {
  registeredApplicationId: string;
  environment: MdbaseApplicationDeclaration["environment"];
}) {
  return new MdbaseConnect({ id: input.registeredApplicationId, name: manifest.name,
    origin: new URL(manifest.homepage).origin, environment: input.environment, manifest });
}
