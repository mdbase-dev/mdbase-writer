import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ConnectLayout } from "@mdbase-dev/ui/screens";
import {
  SignInTabBlocked,
  authorizeNativeSignIn,
  signInCopy,
  signInPresentation,
  type createNativeSignIn,
} from "../connect/native-signin-ui.js";

interface NativeSignInProps {
  /** Actual SDK instance plus its UI tab reservation; caller owns the lifetime. */
  binding: ReturnType<typeof createNativeSignIn>;
  /** Close succeeded. Owner may show signed-out UI; original stores stay. */
  onSignedOut(): void;
}

/** Presentation/actions only: no polling, custody, grants or session engine. */
export function NativeSignIn(props: NativeSignInProps) {
  useLingui();
  return <NativeSignInView key={props.binding.viewKey} {...props} />;
}

function NativeSignInView({ binding, onSignedOut }: NativeSignInProps) {
  useLingui();
  const { session, portal } = binding;
  const snapshot = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => session.getSnapshot(),
    () => session.getSnapshot(),
  );
  const [problem, setProblem] = useState<"tab_blocked" | "interrupted" | null>(
    null,
  );
  const [working, setWorking] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const foreground = () => {
      if (session.getSnapshot().status === "closed") return;
      try {
        session.setForeground(document.visibilityState === "visible");
      } catch {
        if (mounted.current) setProblem("interrupted");
      }
    };
    document.addEventListener("visibilitychange", foreground);
    // External SDK synchronization, not a React-state reset. A fenced owner
    // will publish closure or refuse the next explicit action.
    if (session.getSnapshot().status !== "closed") {
      try {
        session.setForeground(document.visibilityState === "visible");
      } catch {
        /* Retired owner; do not publish late state. */
      }
    }
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", foreground);
      portal.cancel();
      // Borrowed SDK session: its actual owner handles unmount/HMR shutdown.
    };
  }, [session, portal]);

  useEffect(() => {
    // An already paired account may still be authorizing additional consent.
    if (
      [
        "unselected",
        "opening",
        "setup_required",
        "ready",
        "blocked",
        "closed",
      ].includes(snapshot.status)
    ) {
      portal.cancel();
    }
  }, [portal, snapshot.status]);

  const act = async (action: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    setWorking(true);
    setProblem(null);
    try {
      await action();
    } catch (reason) {
      if (mounted.current) {
        setProblem(
          reason instanceof SignInTabBlocked ? "tab_blocked" : "interrupted",
        );
      }
    } finally {
      if (mounted.current) {
        busy.current = false;
        setWorking(false);
      }
    }
  };
  const view = signInPresentation(snapshot, "mdbase writer", problem);
  const signOut = async () => {
    await session.close();
    portal.cancel();
    if (mounted.current) onSignedOut();
  };
  const authorize = () => authorizeNativeSignIn(session, portal);

  return (
    <ConnectLayout app="writer" title={t`Write from your collection`}>
      <section aria-label={t`Sign-in status`}>
        {view.identity ? <p>{view.identity}</p> : null}
        <p role={view.error ? "alert" : "status"} aria-live="polite">
          {view.message}
        </p>
        {view.unavailable ? <p>{signInCopy.unavailable}</p> : null}
        <div className="connection-actions">
          {view.waiting ? (
            <button
              className="mdbase-button"
              type="button"
              disabled={working}
              onClick={() => void act(authorize)}
            >
              {signInCopy.reopen}
            </button>
          ) : !view.paired || view.error ? (
            <button
              className="mdbase-connect-action"
              type="button"
              disabled={working || view.disabled}
              onClick={() => void act(authorize)}
            >
              {view.action}
            </button>
          ) : null}
          {view.paired ? (
            <button
              className="mdbase-button"
              type="button"
              disabled={working}
              onClick={() => void act(signOut)}
            >
              {signInCopy.signOut}
            </button>
          ) : null}
          {snapshot.selectedCollectionId ? (
            <button
              className="mdbase-button"
              type="button"
              disabled={working}
              onClick={() => {
                const collectionId = snapshot.selectedCollectionId;
                if (collectionId) void act(() => session.forget(collectionId));
              }}
            ><Trans>
              Forget collection
            </Trans></button>
          ) : null}
        </div>
      </section>
    </ConnectLayout>
  );
}
