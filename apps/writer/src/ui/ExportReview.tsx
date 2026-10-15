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
  return (
    <Dialog open={Boolean(pending)} onClose={() => { if (pending) onCancel(); }} title="Review export problems">
      <p>No file has been downloaded yet. Missing images or chapters can leave this export incomplete. Review these problems before sharing or submitting it.</p>
      <ul className="export-problems">{pending?.problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>
      <div className="compare-actions">
        <button type="button" className="mdbase-button is-primary" onClick={onCancel}>Cancel and fix problems</button>
        <button type="button" className="mdbase-button" onClick={() => {
          if (!pending) return;
          try { onExport(pending); }
          catch (error) { onError(error); }
        }}>Export anyway</button>
      </div>
    </Dialog>
  );
}
