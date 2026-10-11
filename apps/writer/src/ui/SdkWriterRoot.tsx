import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { MdbaseApplication, MdbaseApplicationConnection, MdbaseApplicationEntry, MdbaseClient } from "@mdbase-dev/sdk";
import { ConnectLayout } from "@mdbase-dev/ui/screens";
import { NextWriterRecords } from "../backend/next-records.js";
import { NativeWriterView } from "./NativeWriterView.js";

export type WriterSdk = MdbaseApplicationEntry;
export interface WriterNativeScope {
  readonly application: MdbaseApplication;
  readonly connection: MdbaseApplicationConnection;
  readonly records: NextWriterRecords;
  readonly signal: AbortSignal;
}
export interface SdkWriterRootProps {
  sdk: WriterSdk;
  onSignedOut?(): void;
  /** Real native domain UI only. Never supply a fake legacy backend/client. */
  renderNative?(scope: WriterNativeScope): ReactNode;
}
const keys = new WeakMap<WriterSdk, number>();
let nextKey = 0;
function key(sdk: WriterSdk) { let value = keys.get(sdk); if (value === undefined) { value = ++nextKey; keys.set(sdk, value); } return value; }

export function SdkWriterRoot(props: SdkWriterRootProps) {
  return <ApplicationView key={key(props.sdk)} {...props} />;
}
function ApplicationView({ sdk, renderNative, onSignedOut }: SdkWriterRootProps) {
  const application = sdk.application();
  const snapshot = useSyncExternalStore(listener => application.subscribe(listener), () => application.getSnapshot(), () => application.getSnapshot());
  const caller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState(false);
  useEffect(() => {
    const scope = new AbortController(); caller.current = scope;
    const foreground = () => {
      if (scope.signal.aborted || application.getSnapshot().status === "closed") return;
      try { application.setForeground(document.visibilityState === "visible"); } catch { /* SDK owner may be unavailable/retired. */ }
    };
    document.addEventListener("visibilitychange", foreground); foreground();
    queueMicrotask(() => {
      if (scope.signal.aborted || application.getSnapshot().status !== "not_started") return;
      void application.start({ signal: scope.signal }).catch(() => { if (!scope.signal.aborted) setProblem(true); });
    });
    return () => {
      scope.abort(); document.removeEventListener("visibilitychange", foreground);
      try { if (application.getSnapshot().status !== "closed") application.setForeground(false); } catch { /* No owner replacement/physical-close claim. */ }
    };
  }, [application]);
  const act = async (action: (signal: AbortSignal) => Promise<unknown>) => {
    const scope = caller.current;
    if (!scope || scope.signal.aborted || busy.current) return;
    busy.current = true; setWorking(true); setProblem(false);
    try { await action(scope.signal); }
    catch { if (!scope.signal.aborted) setProblem(true); }
    finally { if (!scope.signal.aborted) { busy.current = false; setWorking(false); } }
  };
  const selected = snapshot.selection.usable?.collectionId === snapshot.selectedCollectionId ? snapshot.selection.usable : null;
  const connection = selected && snapshot.status === "ready" ? sdk.connection(selected.collectionId) : null;
  const ready = connection && connection.id === selected?.collectionId && connection.records.hello.collection === connection.id && connection.isCurrent()
    && !snapshot.readiness.checking && snapshot.readiness.problem === null && snapshot.readiness.assessment?.status === "ready" && snapshot.readiness.assessment.problem === null;
  if (ready && connection) {
    const picker = <span className="native-signin-actions">
      <span>{connection.displayName}</span>
      <button type="button" className="mdbase-button" disabled={working} onClick={() => void act(signal => application.chooseAnother({ signal }))}>Choose another collection</button>
      <button type="button" className="mdbase-button" disabled={working} onClick={() => void act(async signal => { await application.close(); signal.throwIfAborted(); onSignedOut?.(); })}>Sign out</button>
      {problem ? <span role="alert">This action could not be completed. Please try again.</span> : null}
    </span>;
    return <NativeScopeView key={`${connection.id}:${connection.generation}`} connection={connection} application={application} renderNative={renderNative} collectionPicker={picker} />;
  }
  const unavailable = snapshot.problem === "application_not_yet_available";
  const closed = snapshot.status === "closed";
  const waiting = snapshot.status === "authorizing" || snapshot.selection.state === "approving";
  const opening = ["starting", "opening"].includes(snapshot.status) || snapshot.selection.state === "opening" || snapshot.readiness.checking;
  const requested = snapshot.selection.requested.collectionId;
  const approvalRequired = snapshot.selection.state === "approval_required";
  const invalidSelection = snapshot.selection.state === "invalid";
  const signIn = !closed && snapshot.signIn?.state === "paired" ? snapshot.signIn : null;
  const identity = signIn?.accountEmail ? `Signed in as ${signIn.accountEmail}` : signIn?.accountProvider === "github" && signIn.accountLogin ? `Signed in as ${signIn.accountLogin} on GitHub` : null;
  const error = problem || snapshot.status === "blocked" || snapshot.selection.problem !== null;
  const message = unavailable ? "Opening collections isn't available in this build yet." : closed ? "Writer has signed out. Reload to sign in again."
    : invalidSelection ? "This collection link isn't valid. Choose another collection." : error ? "This action could not be completed. Please try again." : waiting ? "Waiting for approval in the mdbase tab…"
    : approvalRequired ? "This collection needs your approval before Writer can open it."
    : snapshot.status === "setup_required" ? "This collection needs Writer setup before writing." : opening || snapshot.status === "ready" ? `Opening ${selected?.displayName ?? "your collection"}…`
    : signIn ? "Choose a collection to start writing." : "Sign in with your mdbase account to sync mdbase writer across your devices.";
  return <ConnectLayout app="writer" title="Write from your collection">
    {identity ? <p>{identity}</p> : null}<p role={error ? "alert" : "status"} aria-live="polite">{message}</p>
    <div className="native-signin-actions">
      {!closed && !unavailable && !waiting && !opening && !invalidSelection ? <button type="button" className="mdbase-button is-primary" disabled={working} onClick={() => void act(signal => application.approve(requested, { signal }))}>{requested ? "Approve collection" : signIn ? "Add a collection" : "Sign in"}</button> : null}
      {signIn && !waiting && !opening && (snapshot.status === "blocked" || snapshot.selection.state === "blocked") ? <button type="button" className="mdbase-button" disabled={working} onClick={() => void act(signal => application.reauthorize({ signal }))}>Review access</button> : null}
      {signIn ? <button type="button" className="mdbase-button" disabled={working} onClick={() => void act(async signal => { await application.close(); signal.throwIfAborted(); onSignedOut?.(); })}>Sign out</button> : null}
      {!closed && !unavailable && (snapshot.status === "setup_required" || snapshot.readiness.assessment?.status === "setup_required") ? <button type="button" className="mdbase-button is-primary" disabled={working} onClick={() => void act(signal => application.configure({ signal }))}>Set up Writer</button> : null}
      {snapshot.selectedCollectionId && !closed ? <>
        <button type="button" className="mdbase-button" disabled={working} onClick={() => { const id = snapshot.selectedCollectionId; if (id) void act(signal => application.forget(id, { signal })); }}>Forget collection</button>
      </> : null}
      {!closed && (snapshot.selectedCollectionId || requested || invalidSelection) ? <button type="button" className="mdbase-button" disabled={working} onClick={() => void act(signal => application.chooseAnother({ signal }))}>Choose another collection</button> : null}
    </div>
    {!closed && !unavailable && !invalidSelection && !approvalRequired ? <div className="native-signin-actions">{snapshot.collections.map(c => <button key={c.collectionId} type="button" className="mdbase-button" disabled={working || waiting || opening} onClick={() => void act(signal => application.select(c.collectionId, { signal }))}>{c.displayName}</button>)}</div> : null}
  </ConnectLayout>;
}
function NativeScopeView({ connection, application, renderNative, collectionPicker }: { connection: MdbaseApplicationConnection; application: MdbaseApplication; renderNative?: SdkWriterRootProps["renderNative"]; collectionPicker: ReactNode }) {
  const [view, setView] = useState<{ client: MdbaseClient; scope: WriterNativeScope } | null>(null);
  const client = connection.records;
  // Parent keys by original SDK ID/generation. Snapshot publications may return
  // a new facade object for that same scope; do not retire its active leases.
  const [originalConnection] = useState(connection);
  useEffect(() => {
    const lifetime = new AbortController();
    const records = new NextWriterRecords(client, lifetime.signal, () => originalConnection.isCurrent());
    let active = true;
    queueMicrotask(() => { if (active) setView({ client, scope: { application, connection: originalConnection, records, signal: lifetime.signal } }); });
    return () => { active = false; lifetime.abort(); records.dispose(); };
  }, [application, client, originalConnection]);
  if (!view || view.client !== client) return <ConnectLayout app="writer" title="Opening your collection"><p role="status">Opening Writer…</p></ConnectLayout>;
  return renderNative ? renderNative(view.scope) : <NativeWriterView scope={view.scope} collectionPicker={collectionPicker} />;
}
