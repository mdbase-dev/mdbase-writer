import type { MdbaseConnectionInfo } from "@mdbase-dev/connect";
import { Dialog } from "@mdbase-dev/ui/dialog";
import { useState } from "react";
import { createPortal } from "react-dom";

import type { WriterSession } from "../connect/session.js";

/** Only shown on Home, where there is no open manuscript to save before switching. */
export function CollectionPicker({ name, collectionId, connections, session }: {
  name: string;
  collectionId: string;
  connections: readonly MdbaseConnectionInfo[];
  session: Pick<WriterSession, "select" | "authorize">;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const close = () => {
    setOpen(false);
    setProblem(null);
  };
  const choose = (id: string) => {
    if (id === collectionId) {
      close();
      return;
    }
    setProblem(null);
    try {
      const result = session.select(id);
      if (result.ok) close();
      else setProblem(result.problem.message);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not switch collections.");
    }
  };
  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await session.authorize("choose", { presentation: "popup", timeoutMs: 10 * 60_000 });
      if (result.ok) setOpen(false);
      else setProblem(result.problem.message);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not connect another collection.");
    } finally {
      setBusy(false);
    }
  };
  // Keep the active collection visible even if it isn't in the cached connection list.
  const choices = [{ collectionId, displayName: name }, ...connections.filter((c) => c.collectionId !== collectionId)];
  return (
    <>
      <button
        type="button"
        className="collection-picker-trigger"
        aria-label={`Switch collection: ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <strong>{name}</strong><span aria-hidden="true"> ▾</span>
      </button>
      {createPortal(<Dialog open={open} onClose={close} title="Choose a collection" className="collection-picker-dialog">
        <ul className="collection-picker-list">
          {choices.map((c) => (
            <li key={c.collectionId}>
              <button
                type="button"
                className="mdbase-button"
                aria-current={c.collectionId === collectionId ? "true" : undefined}
                disabled={busy}
                onClick={() => choose(c.collectionId)}
              >
                <strong>{c.displayName}</strong>
                {c.collectionId === collectionId && <span className="muted small">Current collection</span>}
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="mdbase-connect-action" disabled={busy} onClick={() => void connect()}>
          {busy ? "Waiting for mdbase connect…" : "Connect another collection"}
        </button>
        {problem && <p className="problem" role="alert">{problem}</p>}
      </Dialog>, document.body)}
    </>
  );
}
