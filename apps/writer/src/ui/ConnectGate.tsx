import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
// Everything before a collection is ready: starting, choosing and
// authorizing a collection, and reviewing the setup the writer needs.
import type { MdbaseApplicationSessionSnapshot } from "@mdbase-dev/connect";
import { ConnectLayout, OpeningScreen } from "@mdbase-dev/ui/screens";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { FeedbackButton, useFeedback } from "@mdbase-dev/ui/feedback";

import type { WriterSession } from "../connect/session.js";
import { NativeSignIn } from "./NativeSignIn.js";
import type { NativeSignInBinding } from "../connect/native-signin-ui.js";

const isLocalBuild = location.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

const RESOURCE_ACTION: Record<string, string> = {
  get create() { return t`will be added`; },
  get update() { return t`will be updated`; },
  get delete() { return t`will be removed`; },
  get adopt() { return t`already present`; },
  get unchanged() { return t`already present`; },
  get preserve() { return t`kept as it is`; },
  get conflict() { return t`conflicts with an existing file`; },
};

function Centered({ title, children }: { title: string; children: ReactNode }) {
  useLingui();
  return <ConnectLayout app="writer" title={title}>{children}<FeedbackButton /></ConnectLayout>;
}

export function ConnectGate(props:
  | { nativeSignIn: { binding: NativeSignInBinding; onSignedOut(): void } }
  | { session: WriterSession; snapshot: MdbaseApplicationSessionSnapshot }
) {
  useLingui();
  return "nativeSignIn" in props ? <NativeSignIn {...props.nativeSignIn} /> : <LegacyConnectGate session={props.session} snapshot={props.snapshot} />;
}

function LegacyConnectGate({ session, snapshot }: { session: WriterSession; snapshot: MdbaseApplicationSessionSnapshot }) {
  useLingui();
  const { reportError } = useFeedback();
  const reportedInitialFailure = useRef(false);
  useEffect(() => {
    if (snapshot.status === "start_failed" && !reportedInitialFailure.current && !/cancel|abort|supersed/u.test(snapshot.problem.code)) {
      reportedInitialFailure.current = true;
      reportError({ code: "unknown_error" });
    }
  }, [snapshot, reportError]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (action: () => Promise<{ ok: boolean; problem?: { message?: string; code: string } }>) => {
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await action();
      if (!outcome.ok && !/cancel|abort|supersed/u.test(outcome.problem?.code ?? "")) {
        setProblem(outcome.problem?.message ?? outcome.problem?.code ?? t`Something went wrong.`);
        reportError({ code: "unknown_error" });
      }
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) {
        setProblem(t`This action could not be completed. Please try again.`);
        reportError({ code: "unknown_error" });
      }
    } finally {
      setBusy(false);
    }
  };
  const authorize = (target: "choose" | "selected") =>
    run(() => session.authorize(target, { presentation: "popup", timeoutMs: 10 * 60_000 }) as Promise<{ ok: boolean; problem?: { message?: string; code: string } }>);
  const error = problem && <p className="problem" role="alert">{problem}</p>;

  switch (snapshot.status) {
    case "not_started":
    case "starting":
    case "checking_setup":
      return (
        <OpeningScreen app="writer" title={t`Opening mdbase writer`} detail={snapshot.status === "checking_setup" ? t`Checking the collection` : t`Connecting to mdbase connect`} />
      );
    case "start_failed":
      return (
        <Centered title={t`mdbase connect is unavailable`}>
          <p>{snapshot.problem.message}</p>
          {isLocalBuild && (
            <p className="muted"><Trans>
              This is a local development build. The hosted mdbase connect service only accepts applications served over HTTPS, so use
              Connect's local environment (<code>pnpm dev:environment:up</code> in mdbase-connect) or open the <a href="?demo">demo collection</a>.
            </Trans></p>
          )}
          <button className="mdbase-button" type="button" onClick={() => void run(() => session.start() as Promise<{ ok: boolean }>)} disabled={busy}><Trans>
            Try again
          </Trans></button>
        </Centered>
      );
    case "unselected":
    case "authorization_required":
      return (
        <Centered title={t`Write from your collection`}>
          <p><Trans>
            mdbase writer typesets Markdown records in an mdbase collection into PDF and Word documents, with citations from your mdbase Reader library.
            Connect a collection to choose what it can access.
          </Trans></p>
          <button className="mdbase-connect-action" type="button" onClick={() => void authorize(snapshot.status === "authorization_required" ? "selected" : "choose")} disabled={busy}>
            {busy ? t`Waiting for mdbase connect…` : t`Connect a collection`}
          </button>
          {snapshot.connections.length > 0 && snapshot.status === "unselected" && (
            <section className="gate-list">
              <h2><Trans>Previously connected</Trans></h2>
              <ul>
                {snapshot.connections.map((c) => (
                  <li key={c.collectionId}>
                    <button className="link" type="button" onClick={() => session.select(c.collectionId, { history: "replace" })}>
                      {c.displayName}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {error}
        </Centered>
      );
    case "setup_review_required":
      return (
        <Centered title={t`Set up this collection for writing`}>
          <p><Trans>
            mdbase writer needs two record contracts in <strong>{snapshot.info.displayName}</strong>: manuscripts, and Reader sources for
            citations. Setting up adds only what is missing; existing records are not changed.
          </Trans></p>
          <ul className="setup-list">
            {snapshot.update.typePacks.flatMap((pack) =>
              pack.resources.map((r) => (
                <li key={`${r.target}`}>
                  <code>{r.target}</code> <span className="muted">{RESOURCE_ACTION[r.action]}</span>
                </li>
              )),
            )}
          </ul>
          {!snapshot.update.canApply && <p className="problem">{snapshot.update.reason}</p>}
          <button className="mdbase-button is-primary" type="button" disabled={busy || !snapshot.update.canApply} onClick={() => void run(() => session.applyCollectionSetup({ timeoutMs: 60_000 }) as Promise<{ ok: boolean }>)}>
            {busy ? t`Setting up…` : t`Set up collection`}
          </button>
          {error}
        </Centered>
      );
    case "unavailable":
      return (
        <Centered title={t`This collection is unavailable`}>
          <p className="muted">{String(snapshot.reason)}</p>
          <div className="actions">
            <button className="mdbase-button" type="button" onClick={() => void authorize("selected")} disabled={busy}><Trans>
              Reconnect
            </Trans></button>
            <button className="mdbase-button" type="button" onClick={() => session.clearSelection()}><Trans>
              Choose another collection
            </Trans></button>
          </div>
          {error}
        </Centered>
      );
    case "blocked":
      return (
        <Centered title={t`mdbase writer can't use this collection`}>
          <p>{snapshot.problem.message}</p>
          {snapshot.problem.recovery && <p className="muted">{snapshot.problem.recovery}</p>}
          <button className="mdbase-button" type="button" onClick={() => session.clearSelection()}><Trans>
            Choose another collection
          </Trans></button>
        </Centered>
      );
    case "destroyed":
    case "ready":
      return null;
  }
}
