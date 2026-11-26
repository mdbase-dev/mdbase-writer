import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { ConfirmDialog } from "@mdbase-dev/ui/confirm-dialog";
import { signalMdbaseMark } from "@mdbase-dev/ui/mark-activity";
import { useEffect, useId, useState, type RefObject } from "react";

import type { Result } from "../backend/types.js";

export interface DeleteTarget {
  readonly path: string;
  readonly title: string;
}

export function DeleteDocumentDialog({
  target,
  open,
  onClose,
  onDelete,
  onDeleted,
  returnFocusRef,
}: {
  readonly target: DeleteTarget | null;
  readonly open: boolean;
  onClose(): void;
  onDelete(path: string): Promise<Result<void>>;
  onDeleted(path: string): void;
  readonly returnFocusRef?: RefObject<HTMLElement | null> | undefined;
}) {
  useLingui();
  const inputId = useId();
  const [last, setLast] = useState<DeleteTarget | null>(target);
  if (target && target !== last) setLast(target);
  const current = target ?? last;
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTyped("");
      setBusy(false);
      setError(null);
    }
  }, [open, target?.path]);

  if (!current) return null;
  const expectedName = (current.title.trim() || current.path).trim();
  const matches = typed.trim() === expectedName;

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await onDelete(current.path);
      if (result.ok) {
        onDeleted(current.path);
        onClose();
      } else {
        setError(result.message);
        signalMdbaseMark("error");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t`Could not delete the document. Please try again.`);
      signalMdbaseMark("error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      returnFocusRef={returnFocusRef}
      title={t`Delete “${expectedName}”?`}
      consequence={t`This deletes ${current.path} from this collection. This cannot be undone here.`}
      confirmLabel={t`Delete document`}
      pendingLabel={t`Deleting…`}
      busy={busy}
      disabled={!matches}
      onClose={onClose}
      onConfirm={confirm}
    >
      <label htmlFor={inputId}>
        <Trans>Type <strong>{expectedName}</strong> to confirm</Trans>
      </label>
      <input
        id={inputId}
        className="mdbase-field"
        data-autofocus
        value={typed}
        placeholder={expectedName}
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        onChange={(event) => {
          setTyped(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches && !busy) {
            event.preventDefault();
            void confirm();
          }
        }}
      />
      {error && <p className="problem" role="alert">{error}</p>}
    </ConfirmDialog>
  );
}
