import { useEffect, useState } from "react";
import { Dialog } from "@mdbase-dev/ui/dialog";
import type { JsonObject } from "@mdbase-dev/connect";

/** Highlight the changed passage while keeping the unchanged context readable. */
export function changedPassage(mine: string, theirs: string): { prefix: string; mine: string; theirs: string; suffix: string } {
  const a = mine.split("\n");
  const b = theirs.split("\n");
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let end = 0;
  while (end < a.length - start && end < b.length - start && a[a.length - end - 1] === b[b.length - end - 1]) end++;
  return {
    prefix: a.slice(0, start).join("\n"), mine: a.slice(start, a.length - end).join("\n"),
    theirs: b.slice(start, b.length - end).join("\n"), suffix: end ? a.slice(a.length - end).join("\n") : "",
  };
}

export interface Comparison {
  readonly path: string;
  readonly kind: "conflict" | "draft";
  readonly mine: string;
  readonly theirs: string;
  readonly mineFields: JsonObject;
  readonly theirFields: JsonObject;
}

export function CompareDialog({ comparison, canRestore = true, onClose, onResolve, onDownload }: {
  comparison: Comparison | null;
  canRestore?: boolean;
  onClose(): void;
  onResolve(choice: "mine" | "theirs" | { body: string }): void;
  onDownload(): void;
}) {
  const [merged, setMerged] = useState("");
  useEffect(() => setMerged(comparison?.mine ?? ""), [comparison?.path, comparison?.mine]);
  const diff = comparison ? changedPassage(comparison.mine, comparison.theirs) : null;
  const metadataChanged = comparison && JSON.stringify(comparison.mineFields) !== JSON.stringify(comparison.theirFields);
  return (
    <Dialog open={Boolean(comparison)} onClose={onClose} title={comparison?.kind === "draft" ? "Review recovered local draft" : "Compare conflicting versions"} className="compare-dialog">
      {comparison && diff && <>
        <p><code>{comparison.path}</code></p>
        <p className="muted">Nothing is replaced until you choose. Highlighted passages differ between the versions.</p>
        <div className="compare-columns">
          {([['Your local text', diff.mine], ['Collection version', diff.theirs]] as const).map(([label, change]) => <section key={label}>
            <h3>{label}</h3>
            <pre className="compare-text">{diff.prefix && `${diff.prefix}\n`}{comparison.mine !== comparison.theirs && <mark>{change || "(passage removed)"}</mark>}{diff.suffix && `\n${diff.suffix}`}</pre>
          </section>)}
        </div>
        {metadataChanged && <details><summary>Settings also differ</summary><div className="compare-columns">
          <pre>{JSON.stringify(comparison.mineFields, null, 2)}</pre><pre>{JSON.stringify(comparison.theirFields, null, 2)}</pre>
        </div></details>}
        {comparison.kind === "conflict" && <label className="merge-field">Merged Markdown
          <textarea className="mdbase-field" rows={12} value={merged} onChange={(event) => setMerged(event.target.value)} />
          <span className="muted small">The merged text keeps your local setting changes on top of the collection version.</span>
        </label>}
        {!canRestore && <p>This record was deleted. Download the local draft to preserve it; it cannot be restored into a deleted record.</p>}
        <div className="compare-actions">
          <button type="button" className="mdbase-button" onClick={onDownload}>Download local draft</button>
          <button type="button" className="mdbase-button" onClick={() => onResolve("theirs")}>Use collection version</button>
          <button type="button" className="mdbase-button" disabled={!canRestore} onClick={() => onResolve("mine")}>{comparison.kind === "draft" ? "Restore local draft" : "Keep mine"}</button>
          {comparison.kind === "conflict" && <button type="button" className="mdbase-button is-primary" onClick={() => onResolve({ body: merged })}>Save merged version</button>}
        </div>
      </>}
    </Dialog>
  );
}
