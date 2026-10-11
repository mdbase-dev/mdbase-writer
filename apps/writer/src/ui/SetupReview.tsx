import { useCallback, useEffect, useRef, useState } from "react";
import { isMdbaseError, type MdbaseApplication, type MdbaseSetupPlan } from "@mdbase-dev/sdk";
import { ConnectLayout } from "@mdbase-dev/ui/screens";

type State =
  | { kind: "planning"; note?: string | undefined }
  | { kind: "review"; plan: MdbaseSetupPlan; note?: string | undefined }
  | { kind: "applying"; plan: MdbaseSetupPlan }
  | { kind: "failed"; message: string };
const changedNote = "This collection changed while you were reviewing. Here are the updated changes.";

/** One review before setup: the SDK plan's summary and plain per-change
 * messages. Nothing is written until Confirm, which applies exactly the
 * reviewed plan; a collection that changed meanwhile is planned again. */
export function SetupReview({ application, displayName, onCancel, onApplied }: {
  application: Pick<MdbaseApplication, "setup">; displayName: string; onCancel(): void; onApplied?(): void;
}) {
  const [state, setState] = useState<State>({ kind: "planning" });
  const adopt = useRef<Readonly<Record<string, string>> | undefined>(undefined);
  const scope = useRef<AbortController | null>(null);
  const plan = useCallback(async (note?: string) => {
    const signal = scope.current?.signal;
    if (!signal || signal.aborted) return;
    setState({ kind: "planning", note });
    try {
      const next = await application.setup.plan({ signal, ...(adopt.current ? { adopt: adopt.current } : {}) });
      if (!signal.aborted) setState({ kind: "review", plan: next, note });
    } catch { if (!signal.aborted) setState({ kind: "failed", message: "Writer couldn't check what setup would change." }); }
  }, [application]);
  useEffect(() => {
    const controller = new AbortController(); scope.current = controller;
    // StrictMode replays effects; only the surviving scope plans.
    queueMicrotask(() => { if (!controller.signal.aborted) void plan(); });
    return () => controller.abort();
  }, [plan]);
  const confirm = async (reviewed: MdbaseSetupPlan) => {
    const signal = scope.current?.signal;
    if (!signal || signal.aborted) return;
    setState({ kind: "applying", plan: reviewed });
    try { await application.setup.apply(reviewed, { signal }); if (!signal.aborted) onApplied?.(); }
    catch (error) {
      if (signal.aborted) return;
      if (isMdbaseError(error) && error.reason === "setup_changed") return void plan(changedNote);
      setState({ kind: "failed", message: "Setup didn't finish. Nothing was changed." });
    }
  };
  const shown = state.kind === "review" || state.kind === "applying" ? state.plan : null;
  const busy = state.kind === "planning" || state.kind === "applying";
  const adoptable = shown?.refusal?.code === "setup_conflict" && shown.conflicts.length > 0 && shown.conflicts.every(c => c.adoptable);
  const note = "note" in state ? state.note : undefined;
  return <ConnectLayout app="writer" title={`Set up ${displayName}`}>
    {note ? <p role="status">{note}</p> : null}
    {state.kind === "failed" ? <p className="problem" role="alert">{state.message}</p>
      : <p role="status" aria-live="polite">{state.kind === "planning" ? "Checking what setup would change…" : shown?.summary}</p>}
    {shown && (shown.changes.length > 0 || shown.conflicts.length > 0) ? <ul className="setup-list">
      {shown.changes.map(change => <li key={`${change.kind}:${change.target}`}>{change.message}</li>)}
      {shown.conflicts.map(conflict => <li key={`conflict:${conflict.target}`} className="problem">{conflict.message}</li>)}
    </ul> : null}
    <div className="actions">
      {state.kind === "failed" ? <button type="button" className="mdbase-button is-primary" onClick={() => void plan()}>Try again</button>
        : adoptable && shown ? <button type="button" className="mdbase-button is-primary" disabled={busy} onClick={() => { adopt.current = shown.adoptable; void plan(); }}>Use Writer's version</button>
          : <button type="button" className="mdbase-button is-primary" disabled={busy || !shown || (!shown.canApply && shown.status !== "current")} onClick={() => { if (shown) void confirm(shown); }}>
            {state.kind === "applying" ? "Setting up…" : shown?.status === "current" ? "Continue" : "Confirm"}
          </button>}
      <button type="button" className="mdbase-button" disabled={state.kind === "applying"} onClick={onCancel}>Cancel</button>
    </div>
  </ConnectLayout>;
}
