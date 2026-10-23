import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Dialog } from "@mdbase-dev/ui/dialog";

export interface PendingExport {
  bytes: Uint8Array;
  type: string;
  name: string;
  problems: readonly string[];
}

/** A programmatic close after confirmation must not cancel its outcome notice. */
export function ExportReview({ pending, onCancel, onExport, onError }: {
  pending: PendingExport | null;
  onCancel(): void;
  onExport(pending: PendingExport): void;
  onError(error: unknown): void;
}) {
  useLingui();
  return (
    <Dialog open={Boolean(pending)} onClose={() => { if (pending) onCancel(); }} title={t`Review export problems`}>
      <p><Trans>No file has been downloaded yet. Missing images or chapters can leave this export incomplete. Review these problems before sharing or submitting it.</Trans></p>
      <ul className="export-problems">{pending?.problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>
      <div className="compare-actions">
        <button type="button" className="mdbase-button is-primary" onClick={onCancel}><Trans>Cancel and fix problems</Trans></button>
        <button type="button" className="mdbase-button" onClick={() => {
          if (!pending) return;
          try { onExport(pending); }
          catch (error) { onError(error); }
        }}><Trans>Export anyway</Trans></button>
      </div>
    </Dialog>
  );
}
