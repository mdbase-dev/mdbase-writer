// The Connect application session for mdbase writer.
import { MdbaseBrowserSelection, MdbaseConnect, type JsonObject, type MdbaseAppManifest } from "@mdbase-dev/connect";

import bundledManifest from "../generated/mdbase-app.json";

const applicationUrl = new URL(import.meta.env.BASE_URL, location.origin).href;
const serverParameter = new URL(location.href).searchParams.get("server");
const configuredConnectUrl = import.meta.env.VITE_MDBASE_CONNECT_URL;

function isLoopback(current: Location): boolean {
  return current.protocol === "http:" && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(current.hostname);
}

/** A local development build declares its own origin, as Reader does. */
function manifestFor(manifest: MdbaseAppManifest): MdbaseAppManifest {
  if (!isLoopback(location)) return manifest;
  const callback = new URL(applicationUrl);
  if (serverParameter) callback.searchParams.set("server", new URL(serverParameter).origin);
  return { ...manifest, homepage: applicationUrl, icon: new URL("favicon.svg", applicationUrl).href, redirect_uris: [callback.href] } as MdbaseAppManifest;
}

export function createWriterSession() {
  if (!configuredConnectUrl || !import.meta.env.VITE_MDBASE_CONNECT_LOOPBACK_URL) throw new Error("Writer requires explicit Connect URLs.");
  const callback = new URL(applicationUrl);
  if (serverParameter) callback.searchParams.set("server", new URL(serverParameter).origin);
  const connect = new MdbaseConnect<JsonObject>({
    serverUrl: serverParameter ?? configuredConnectUrl,
    loopbackUrl: import.meta.env.VITE_MDBASE_CONNECT_LOOPBACK_URL,
    manifest: manifestFor(bundledManifest as unknown as MdbaseAppManifest),
    redirectUri: callback.href,
    directAccess: "auto",
    timeouts: { watchStartMs: 60_000 },
  });
  return connect.application({ selection: new MdbaseBrowserSelection({ fallbackPath: import.meta.env.BASE_URL }), autoSelect: "never" });
}

export type WriterSession = ReturnType<typeof createWriterSession>;
