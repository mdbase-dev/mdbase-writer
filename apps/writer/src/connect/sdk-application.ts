import { createMdbase, type Mdbase } from "@mdbase-dev/sdk";
import manifest from "../generated/mdbase-app.json";

/** The explicit build environments that select the native SDK entry. */
export type WriterBuildEnvironment = "lab" | "staging" | "production";

/** Exact app origin for each build environment. These match the deployment
 * table in scripts/deployment-environment.mjs, whose origins the manifest
 * builder declares as installation_origins. Production is held to its exact
 * HTTPS origin; a build for one environment is never retargeted to another.
 */
const WRITER_ORIGINS: Record<WriterBuildEnvironment, string> = {
  lab: "https://lab.mdbase-writer.pages.dev",
  staging: "https://staging.mdbase-writer.pages.dev",
  production: "https://writer.mdbase.dev",
};

const isWriterBuildEnvironment = (environment: string | undefined): environment is WriterBuildEnvironment =>
  environment === "lab" || environment === "staging" || environment === "production";

type WriterManifestOrigins = {
  homepage: string;
  installation_origins?: Partial<Record<WriterBuildEnvironment, Partial<Record<"app-runtime" | "mobile", readonly string[]>>>>;
};

export interface WriterEnvironmentSelection {
  environment: WriterBuildEnvironment;
  origin: string;
}

/** An ordinary build defaults to production. Explicit environment builds must
 * match their bundled manifest; no build can borrow another target's origin. */
export function selectWriterBuildEnvironment(
  environment: string | undefined,
  candidate: WriterManifestOrigins = manifest as WriterManifestOrigins,
): WriterEnvironmentSelection {
  environment ||= "production";
  if (!isWriterBuildEnvironment(environment)) throw new Error(`Unsupported Writer build environment: ${environment}.`);
  const origin = new URL(candidate.homepage).origin;
  const declared = candidate.installation_origins?.[environment]?.["app-runtime"] ?? [];
  if (origin !== WRITER_ORIGINS[environment] || !declared.includes(origin)) {
    throw new Error(
      `Writer ${environment} build refuses manifest origin ${origin}: it requires ${WRITER_ORIGINS[environment]} declared in installation_origins.${environment}.app-runtime.`,
    );
  }
  return { environment, origin };
}

/** App declaration only. The logical manifest ID is not a registration receipt;
 * SDK registration resolves the genuine native binding. An explicit registered
 * ID, when supplied, must match that binding. No app runtime/storage callbacks. */
export function createWriterMdbase(input: {
  registeredApplicationId?: string;
  environment: WriterBuildEnvironment;
}): Mdbase {
  return createMdbase({ id: input.registeredApplicationId ?? manifest.id, name: manifest.name,
    origin: new URL(manifest.homepage).origin, environment: input.environment, manifest },
  {readiness: {typeIssues: "degrade"}});
}

/** The native entry for an explicit lab, staging or production build.
 * Refusals from selectWriterBuildEnvironment propagate: no legacy fallback. */
export function writerMdbaseForBuild(environment: string | undefined): Mdbase {
  return createWriterMdbase({environment: selectWriterBuildEnvironment(environment).environment});
}

/** The SDK's Private-collection consent popup lands back on the manifest's
 * redirect URI (the app root) with `state` and `code` or `error`. Only the SDK
 * entry handles that callback without opening a second collection owner. */
export function isWriterGrantReturn(environment: string | undefined, href: string): boolean {
  if (environment && !isWriterBuildEnvironment(environment)) return false;
  const url = new URL(href);
  const redirect = manifest.redirect_uris.map((uri) => new URL(uri)).find((uri) => uri.origin === url.origin) ?? new URL("/", url.origin);
  return url.pathname === redirect.pathname && url.searchParams.has("state") && (url.searchParams.has("code") || url.searchParams.has("error"));
}

/** Hand the consent result to the waiting Writer tab; it closes this popup. */
export async function deliverWriterGrantReturn(href: string): Promise<void> {
  (await import("@mdbase-dev/sdk/app-grant")).deliverAppGrantCallback(href);
}
