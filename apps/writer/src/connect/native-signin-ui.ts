import { t } from "@lingui/core/macro";
import { AppWebSignInSession } from "@mdbase-dev/sdk/app-host";
import type {
  AppWebSignInSessionOptions,
  AppWebSignInSnapshot,
} from "@mdbase-dev/sdk/app-host";
import { openConnectPopup, type ConnectPopup } from "./connect-popup.js";
export { ConnectPopupBlocked as SignInTabBlocked } from "./connect-popup.js";

export type NativeSignInSession = Pick<
  AppWebSignInSession<never>,
  | "getSnapshot"
  | "subscribe"
  | "start"
  | "authorize"
  | "renewExpiredPairing"
  | "forget"
  | "close"
  | "setForeground"
>;

export const signInCopy = Object.freeze({
  get signIn() { return t`Sign in`; },
  get waiting() { return t`Waiting for approval in the mdbase tab…`; },
  get reopen() { return t`Open the mdbase tab again`; },
  get tabBlocked() { return t`Your browser blocked the sign-in tab.`; },
  get openSignIn() { return t`Open sign-in`; },
  get interrupted() { return t`Sign-in was interrupted. Please try again.`; },
  get signOut() { return t`Sign out`; },
  get unavailable() { return t`Opening collections isn't available in this build yet.`; },
});

/** UI-only public portal capability. The SDK supplies the validated URI. */
export const openSignInPortal = openConnectPopup;

// Popup names are UI ownership identities, never native IDs or namespaces.
let nextPortalKey = 0;

/** Keep the owned handle after SDK handoff, including when it was closed by hand. */
export function createSignInPortalUi() {
  const name = `mdbase-writer-connect-${++nextPortalKey}`;
  let active: ConnectPopup | null = null;
  return {
    reserve() {
      if (!active || active.closed) active = openSignInPortal(name);
    },
    open() {
      if (!active || active.closed) active = openSignInPortal(name);
      return active;
    },
    cancel() {
      const original = active;
      active = null;
      original?.close();
    },
  };
}

// React presentation identity only, never a native actor/record/mutation ID.
let nextViewKey = 0;

export interface NativeSignInBinding {
  session: NativeSignInSession;
  portal: ReturnType<typeof createSignInPortalUi>;
  /** UI-only React identity. */
  viewKey: number;
}

/** Only a public SDK constructor and UI portal; no collection/SQL factory. */
export function createNativeSignIn(
  options: Omit<
    AppWebSignInSessionOptions<never>,
    "openPortal" | "openCollection" | "autoSelect"
  >,
): NativeSignInBinding {
  options.signal.throwIfAborted();
  const portal = createSignInPortalUi();
  const session = new AppWebSignInSession<never>({
    ...options,
    openPortal: portal.open,
    openCollection: unavailableCollection,
    autoSelect: "never",
  });
  return { session, portal, viewKey: ++nextViewKey };
}

/** Reserve in the user gesture BEFORE any asynchronous SDK renewal/start. */
export async function authorizeNativeSignIn(
  session: NativeSignInSession,
  portal: ReturnType<typeof createSignInPortalUi>,
) {
  portal.reserve();
  try {
    if (session.getSnapshot().status === "not_started") await session.start();
    if (session.getSnapshot().problem === "expired")
      await session.renewExpiredPairing();
    return await session.authorize();
  } catch (error) {
    portal.cancel();
    throw error;
  }
}

/** Explicit pre-factory boundary, not a pretend collection or setup result. */
export const unavailableCollection: AppWebSignInSessionOptions<never>["openCollection"] =
  async ({ signal }) => {
    signal.throwIfAborted();
    throw new Error(signInCopy.unavailable);
  };

export function signInPresentation(
  snapshot: AppWebSignInSnapshot,
  appName: string,
  problem: "tab_blocked" | "interrupted" | null = null,
) {
  const paired =
    snapshot.status !== "closed" && snapshot.signIn?.state === "paired";
  const email = paired ? snapshot.signIn?.accountEmail : null;
  const identity = email ? t`Signed in as ${email}` : null;
  const selected = snapshot.collections.find(
    ({ collectionId }) => collectionId === snapshot.selectedCollectionId,
  );
  const waiting = snapshot.status === "authorizing" && problem === null;
  const interrupted =
    problem === "interrupted" || snapshot.status === "blocked";
  const message =
    problem === "tab_blocked"
      ? signInCopy.tabBlocked
      : interrupted
        ? signInCopy.interrupted
        : waiting
          ? signInCopy.waiting
          : snapshot.status === "opening" && selected
            ? t`Signed in. Opening ${selected.displayName}…`
            : (identity ??
              (paired
                ? signInCopy.unavailable
                : t`Sign in with your mdbase account to sync ${appName} across your devices.`));
  return {
    message,
    identity: identity === message ? null : identity,
    waiting,
    paired,
    unavailable: paired && message !== signInCopy.unavailable,
    error: problem !== null || snapshot.status === "blocked",
    action:
      problem === "tab_blocked" ? signInCopy.openSignIn : signInCopy.signIn,
    disabled: ["starting", "opening", "closed"].includes(snapshot.status),
  };
}
