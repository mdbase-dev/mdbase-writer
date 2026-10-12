import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { describeError, summarizeStatus, type MdbaseApplication, type MdbaseApplicationConnection, type MdbaseApplicationEntry, type MdbaseApplicationSnapshot, type MdbaseClient, type MdbaseErrorDescription } from "@mdbase-dev/sdk";
import { ConnectLayout } from "@mdbase-dev/ui/screens";
import { NextWriterRecords } from "../backend/next-records.js";
import { NativeWriterView } from "./NativeWriterView.js";
import { SdkWriterConnection } from "./SdkWriterConnection.js";
import { SetupReview } from "./SetupReview.js";

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
  const busy = useRef(0);
  const latestAction = useRef(0);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<MdbaseErrorDescription | null>(null);
  const [review, setReview] = useState<{readonly id: string | null} | null>(null);
  useEffect(() => {
    const scope = new AbortController(); caller.current = scope;
    const foreground = () => {
      if (scope.signal.aborted || application.getSnapshot().status === "closed") return;
      try { application.setForeground(document.visibilityState === "visible"); } catch { /* SDK owner may be unavailable/retired. */ }
    };
    document.addEventListener("visibilitychange", foreground); foreground();
    queueMicrotask(() => {
      if (scope.signal.aborted || application.getSnapshot().status !== "not_started") return;
      void application.start({ signal: scope.signal }).catch((error: unknown) => { if (!scope.signal.aborted) setProblem(describeError(error) ?? describeError("internal")); });
    });
    return () => {
      scope.abort(); document.removeEventListener("visibilitychange", foreground);
      try { if (application.getSnapshot().status !== "closed") application.setForeground(false); } catch { /* No owner replacement/physical-close claim. */ }
    };
  }, [application]);
  const act = async (action: (signal: AbortSignal) => Promise<unknown>, signIn = false) => {
    const scope = caller.current;
    if (!scope || scope.signal.aborted || (busy.current > 0 && !signIn)) return;
    // Sign-in gestures go to the SDK even while authorizing; it owns renewal.
    const ordinal = ++latestAction.current;
    busy.current++; setWorking(true); setProblem(null);
    try { await action(scope.signal); }
    catch (error: unknown) { if (!scope.signal.aborted && ordinal === latestAction.current) setProblem(describeError(error) ?? describeError("internal")); }
    finally { busy.current--; if (!scope.signal.aborted) setWorking(busy.current > 0); }
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
      {problem ? <span role="alert">{problem.message}</span> : null}
    </span>;
    return <NativeScopeView key={`${connection.id}:${connection.generation}`} connection={connection} application={application} renderNative={renderNative} collectionPicker={picker} problem={snapshot.problem} />;
  }
  // The review stays until it finishes or is cancelled: status and readiness
  // changes while setup is applying must not unmount it and abort the apply.
  if (review && review.id === snapshot.selectedCollectionId && snapshot.status !== "closed") {
    const name = snapshot.collections.find(collection => collection.collectionId === review.id)?.displayName ?? "this collection";
    return <SetupReview key={review.id} application={application} displayName={name} onCancel={() => setReview(null)} onApplied={() => setReview(null)}/>;
  }
  return <SdkWriterConnection application={application} snapshot={snapshot} problem={problem} working={working} act={act} onSignedOut={onSignedOut} requestSetup={() => setReview({id: snapshot.selectedCollectionId})}/>;
}
function NativeScopeView({ connection, application, renderNative, collectionPicker, problem }: { connection: MdbaseApplicationConnection; application: MdbaseApplication; renderNative?: SdkWriterRootProps["renderNative"]; collectionPicker: ReactNode; problem: MdbaseApplicationSnapshot["problem"] }) {
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
  return <><NativeStatus connection={originalConnection} problem={problem}/>{renderNative ? renderNative(view.scope) : <NativeWriterView scope={view.scope} collectionPicker={collectionPicker} />}</>;
}

function NativeStatus({connection, problem}: {readonly connection: MdbaseApplicationConnection; readonly problem: MdbaseApplicationSnapshot["problem"]}) {
  const status = useSyncExternalStore(listener => connection.records.onStatus(listener), () => connection.records.status, () => connection.records.status);
  const summary = summarizeStatus(status, problem);
  const description = describeError(problem);
  return ["collection_migrating", "update_required", "account_suspended"].includes(summary.kind) ? <p className="mdbase-connect-status" role="status">{summary.text}{description?.action === "update_app" && description.updateUrl ? <>{" "}<a href={description.updateUrl} target="_blank" rel="noreferrer">{description.actionLabel}</a></> : null}</p> : null;
}
