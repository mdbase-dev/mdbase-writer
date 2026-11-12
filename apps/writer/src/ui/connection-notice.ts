import { t } from "@lingui/core/macro";
import { createContext, useCallback, useSyncExternalStore } from "react";
import type { MdbaseSnapshot } from "@mdbase-dev/sdk";

/**
 * What the open collection's connection needs to say, from the SDK's own
 * status: nothing while it is connected and live.
 * - saved_on_device: changes are kept on this device until they can sync;
 * - offline: this device has no network;
 * - reconnecting: the sync service cannot be reached, or other devices'
 *   changes have stopped arriving live.
 */
export type ConnectionNotice = "offline" | "reconnecting" | "saved_on_device" | "sync_delayed";

export const SYNC_DELAY_MS = 30_000;

export const connectionNoticeLabels: Record<ConnectionNotice, string> = {
  get offline() { return t`Offline`; },
  get reconnecting() { return t`Reconnecting`; },
  get saved_on_device() { return t`Saved on this device; waiting for sync`; },
  get sync_delayed() { return t`Changes haven't reached the server`; },
};

type Observed = Partial<
  Pick<MdbaseSnapshot, "phase" | "sync" | "transport" | "live">
>;

export function connectionNotice(
  snapshot: Observed | null | undefined,
  online = true,
  now = Date.now(),
): ConnectionNotice | null {
  if (!snapshot || (snapshot.phase && snapshot.phase.kind !== "ready"))
    return null;
  const writes = snapshot.sync?.writes;
  if (writes?.rejected.length || writes?.pending.some(entry => now - entry.createdAt >= SYNC_DELAY_MS))
    return "sync_delayed";
  const health = snapshot.sync?.health ?? snapshot.transport?.kind ?? null;
  if (!online || health === "offline") return "offline";
  if (writes?.saveState === "saved_on_device")
    return "saved_on_device";
  if (
    health === "unreachable" ||
    health === "server_busy" ||
    health === "rate_limited" ||
    snapshot.sync?.connection === "offline" ||
    snapshot.sync?.connection === "reconnecting" ||
    (snapshot.sync?.live ?? snapshot.live) === false
  )
    return "reconnecting";
  return null;
}

const noSource = {
  getSnapshot: () => null,
  subscribe: () => () => undefined,
};

/** The connection notice for an SDK entry, following its snapshots and the
 * browser's online state. */
export function useConnectionNotice(
  source:
    | {
        getSnapshot(): Observed;
        subscribe(listener: () => void): () => void;
      }
    | null
    | undefined,
): ConnectionNotice | null {
  const entry = source ?? noSource;
  const subscribe = useCallback(
    (listener: () => void) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const changed = () => {
        clearTimeout(timer);
        const pending = entry.getSnapshot()?.sync?.writes?.pending ?? [];
        const oldest = Math.min(...pending.map(write => write.createdAt));
        const remaining = oldest + SYNC_DELAY_MS - Date.now();
        if (Number.isFinite(remaining) && remaining > 0) timer = setTimeout(changed, remaining);
        listener();
      };
      const stop = entry.subscribe(changed);
      changed();
      window.addEventListener("online", listener);
      window.addEventListener("offline", listener);
      return () => {
        stop();
        clearTimeout(timer);
        window.removeEventListener("online", listener);
        window.removeEventListener("offline", listener);
      };
    },
    [entry],
  );
  const read = () =>
    connectionNotice(entry.getSnapshot(), globalThis.navigator?.onLine ?? true);
  return useSyncExternalStore(subscribe, read, read);
}

export const ConnectionNoticeContext = createContext<ConnectionNotice | null>(
  null,
);
