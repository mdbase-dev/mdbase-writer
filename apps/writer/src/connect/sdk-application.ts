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
  return usesSdk(environment) ? createWriterMdbase({environment: "lab"}) : undefined;
}
const usesSdk = (environment: string | undefined): boolean => environment === "lab";

/** The SDK's Private-collection consent popup lands back on the manifest's
 * redirect URI (the app root) with `state` and `code` or `error`. Only the SDK
 * entry uses that popup; the legacy entry's own callback is left alone. */
export function isWriterGrantReturn(environment: string | undefined, href: string): boolean {
  if (!usesSdk(environment)) return false;
  const url = new URL(href);
  const redirect = manifest.redirect_uris.map((uri) => new URL(uri)).find((uri) => uri.origin === url.origin) ?? new URL("/", url.origin);
  return url.pathname === redirect.pathname && url.searchParams.has("state") && (url.searchParams.has("code") || url.searchParams.has("error"));
}

/** Hand the consent result to the waiting Writer tab; it closes this popup. */
export async function deliverWriterGrantReturn(href: string): Promise<void> {
  (await import("@mdbase-dev/sdk/app-grant")).deliverAppGrantCallback(href);
}
