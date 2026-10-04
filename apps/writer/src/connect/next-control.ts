// How Writer reaches an mdbase-next replica from the browser.
//
// DEPENDENCY ON THE CONTROL WORKSTREAM: none of the control-plane pieces exist
// yet. Everything here that talks to a server is behind `NextControlPlane`,
// and `proposedControlPlane` implements it against a PROPOSED endpoint:
//
//   GET {serverUrl}/v1/next/collections/:id/route
//     → { "targets": [{ "url": string, "device": uuid, "noise_pk": base64 }] }
//
// An empty `targets` list means none of the account's devices is online. How a
// web app obtains a grant (registering its `client_pk` at consent) is not
// designed yet either: until it is, the grant ID is passed in (`?grant=`).
import { connect, loadOrCreateClientKey, mdbaseError, relayConnector, type MdbaseClient, type MdbaseError, type RelayRoute } from "@mdbase-dev/sdk";

export interface NextControlPlane {
  /**
   * The grant this browser holds for the collection. At consent the control
   * plane must register `clientPublicKey` (the grant's `client_pk`).
   */
  grant(collection: string, clientPublicKey: Uint8Array): Promise<string | null>;
  /** Where to connect now, or `null` when no target (device or hosted replica) is online. */
  route(collection: string): Promise<RelayRoute | null>;
}

function base64Bytes(text: string): Uint8Array {
  const normal = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normal.padEnd(Math.ceil(normal.length / 4) * 4, "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** Parses the proposed route response; the first target is used. */
export function routeFromResponse(body: unknown): RelayRoute | null {
  const targets = body && typeof body === "object" ? (body as { targets?: unknown }).targets : undefined;
  if (!Array.isArray(targets)) throw mdbaseError("internal", "the route response has no targets list", "invalid_route");
  for (const target of targets as unknown[]) {
    if (!target || typeof target !== "object") continue;
    const { url, device, noise_pk: key } = target as Record<string, unknown>;
    if (typeof url !== "string" || typeof device !== "string" || typeof key !== "string") continue;
    const noisePublicKey = base64Bytes(key);
    if (noisePublicKey.length !== 32) continue;
    return { url, targetDevice: device, noisePublicKey };
  }
  return null;
}

/** PROPOSED: the control plane's route endpoint (see the module comment). */
export function proposedControlPlane(options: { serverUrl: string; grant: string | null; fetch?: typeof fetch }): NextControlPlane {
  const request = options.fetch ?? globalThis.fetch.bind(globalThis);
  return {
    // Stub: the consent flow that registers client_pk does not exist yet.
    grant: async () => options.grant,
    async route(collection) {
      let response: Response;
      try {
        response = await request(new URL(`/v1/next/collections/${encodeURIComponent(collection)}/route`, options.serverUrl), { credentials: "include" });
      } catch {
        throw mdbaseError("unavailable", "the control plane is unreachable", "control_unreachable");
      }
      if (response.status === 401) throw mdbaseError("unauthenticated", "sign in again");
      if (response.status === 403) throw mdbaseError("forbidden", "no access to this collection");
      if (response.status === 404) throw mdbaseError("not_found", "no such collection");
      if (!response.ok) throw mdbaseError("unavailable", `route lookup failed (${response.status})`, "control_unavailable");
      return routeFromResponse(await response.json());
    },
  };
}

export interface ConnectNextOptions {
  readonly collection: string;
  readonly control: NextControlPlane;
  /** Called while a private collection waits for one of the person's devices. */
  readonly onWaiting?: (why: MdbaseError) => void;
  readonly signal?: AbortSignal;
}

export const WRITER_CLIENT = { name: "mdbase-writer", version: "0.1.0-beta.0" } as const;

/** A client for one collection over the relay, with this browser's client key. */
export async function connectNext(options: ConnectNextOptions): Promise<MdbaseClient> {
  const staticKey = await loadOrCreateClientKey(WRITER_CLIENT.name);
  const grant = await options.control.grant(options.collection, staticKey.publicKey);
  return connect({
    app: WRITER_CLIENT,
    connector: relayConnector({ collection: options.collection, grant, staticKey, resolveRoute: () => options.control.route(options.collection) }),
    waitForDevice: true,
    ...(options.onWaiting ? { onWaiting: options.onWaiting } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
