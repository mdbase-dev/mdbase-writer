// Everything before a collection is ready: starting, choosing and
// authorizing a collection, and reviewing the setup the writer needs.
import type { MdbaseApplicationSessionSnapshot } from "@mdbase-dev/connect";
import { useState, type ReactNode } from "react";

import type { WriterSession } from "../connect/session.js";

const isLocalBuild = location.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

const RESOURCE_ACTION: Record<string, string> = {
  create: "will be added",
  update: "will be updated",
  delete: "will be removed",
  adopt: "already present",
  unchanged: "already present",
  preserve: "kept as it is",
  conflict: "conflicts with an existing file",
};

function Centered({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="gate">
      <h1>{title}</h1>
      {children}
    </main>
  );
}

export function ConnectGate({ session, snapshot }: { session: WriterSession; snapshot: MdbaseApplicationSessionSnapshot }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (action: () => Promise<{ ok: boolean; problem?: { message?: string; code: string } }>) => {
    setBusy(true);
    setProblem(null);
    const outcome = await action();
    setBusy(false);
    if (!outcome.ok) setProblem(outcome.problem?.message ?? outcome.problem?.code ?? "Something went wrong.");
  };
  const authorize = (target: "choose" | "selected") =>
    run(() => session.authorize(target, { presentation: "popup", timeoutMs: 10 * 60_000 }) as Promise<{ ok: boolean; problem?: { message?: string; code: string } }>);
  const error = problem && <p className="problem" role="alert">{problem}</p>;

  switch (snapshot.status) {
    case "not_started":
    case "starting":
    case "checking_setup":
      return (
        <Centered title="Opening mdbase writer">
          <p className="muted" role="status">
            {snapshot.status === "checking_setup" ? "Checking the collection…" : "Connecting…"}
          </p>
        </Centered>
      );
    case "start_failed":
      return (
        <Centered title="mdbase connect is unavailable">
          <p>{snapshot.problem.message}</p>
          {isLocalBuild && (
            <p className="muted">
              This is a local development build. The hosted mdbase connect service only accepts applications served over HTTPS, so use
              Connect's local environment (<code>pnpm dev:environment:up</code> in mdbase-connect) or open the <a href="?demo">demo collection</a>.
            </p>
          )}
          <button className="button" type="button" onClick={() => void run(() => session.start() as Promise<{ ok: boolean }>)} disabled={busy}>
            Try again
          </button>
        </Centered>
      );
    case "unselected":
    case "authorization_required":
      return (
        <Centered title="Write from your collection">
          <p>
            mdbase writer typesets Markdown records in an mdbase collection into PDF, with citations from your mdbase Reader library.
            Connect a collection to choose what it can access.
          </p>
          <button className="button primary" type="button" onClick={() => void authorize(snapshot.status === "authorization_required" ? "selected" : "choose")} disabled={busy}>
            {busy ? "Waiting for mdbase connect…" : "Connect a collection"}
          </button>
          {snapshot.connections.length > 0 && snapshot.status === "unselected" && (
            <section className="gate-list">
              <h2>Previously connected</h2>
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
        <Centered title="Set up this collection for writing">
          <p>
            mdbase writer needs two record contracts in <strong>{snapshot.info.displayName}</strong>: manuscripts, and Reader sources for
            citations. Setting up adds only what is missing; existing records are not changed.
          </p>
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
          <button className="button primary" type="button" disabled={busy || !snapshot.update.canApply} onClick={() => void run(() => session.applyCollectionSetup({ timeoutMs: 60_000 }) as Promise<{ ok: boolean }>)}>
            {busy ? "Setting up…" : "Set up collection"}
          </button>
          {error}
        </Centered>
      );
    case "unavailable":
      return (
        <Centered title="This collection is unavailable">
          <p className="muted">{String(snapshot.reason)}</p>
          <div className="actions">
            <button className="button" type="button" onClick={() => void authorize("selected")} disabled={busy}>
              Reconnect
            </button>
            <button className="button" type="button" onClick={() => session.clearSelection()}>
              Choose another collection
            </button>
          </div>
          {error}
        </Centered>
      );
    case "blocked":
      return (
        <Centered title="mdbase writer can't use this collection">
          <p>{snapshot.problem.message}</p>
          {snapshot.problem.recovery && <p className="muted">{snapshot.problem.recovery}</p>}
          <button className="button" type="button" onClick={() => session.clearSelection()}>
            Choose another collection
          </button>
        </Centered>
      );
    case "destroyed":
    case "ready":
      return null;
  }
}
