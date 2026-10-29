import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useEffect, useRef, useState } from "react";
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

/** Reveal the first changed passage without scrolling the dialog or page. */
export function revealDifferences(columns: HTMLElement): void {
  for (const text of columns.querySelectorAll<HTMLElement>(".compare-text")) {
    const mark = text.querySelector("mark");
    text.scrollTop = mark ? Math.max(0, text.scrollTop + mark.getBoundingClientRect().top - text.getBoundingClientRect().top - 32) : 0;
  }
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
  useLingui();
  const [merge, setMerge] = useState({ path: comparison?.path, mine: comparison?.mine, text: comparison?.mine ?? "" });
  const changed = merge.path !== comparison?.path || merge.mine !== comparison?.mine;
  if (changed) setMerge({ path: comparison?.path, mine: comparison?.mine, text: comparison?.mine ?? "" });
  const merged = changed ? comparison?.mine ?? "" : merge.text;
  const columns = useRef<HTMLDivElement>(null);
  useEffect(() => { if (columns.current) revealDifferences(columns.current); }, [comparison?.path, comparison?.mine, comparison?.theirs]);
  const diff = comparison ? changedPassage(comparison.mine, comparison.theirs) : null;
  const metadataChanged = comparison && JSON.stringify(comparison.mineFields) !== JSON.stringify(comparison.theirFields);
  return (
    <Dialog open={Boolean(comparison)} onClose={onClose} title={comparison?.kind === "draft" ? t`Review recovered local draft` : t`Compare conflicting versions`} className="compare-dialog">
      {comparison && diff && <>
        <p><code>{comparison.path}</code></p>
        <p className="muted"><Trans>Nothing is replaced until you choose. Highlighted passages differ between the versions.</Trans></p>
        <div className="compare-columns" ref={columns}>
          {([["mine", t`Your local text`, diff.mine], ["theirs", t`Collection version`, diff.theirs]] as const).map(([side, label, change]) => <section key={side}>
            <h3>{label}</h3>
            <pre className="compare-text" tabIndex={0} aria-label={label}>{diff.prefix && `${diff.prefix}\n`}{comparison.mine !== comparison.theirs && <mark>{change || t`(passage removed)`}</mark>}{diff.suffix && `\n${diff.suffix}`}</pre>
          </section>)}
        </div>
        {metadataChanged && <details><summary><Trans>Settings also differ</Trans></summary><div className="compare-columns">
          <pre>{JSON.stringify(comparison.mineFields, null, 2)}</pre><pre>{JSON.stringify(comparison.theirFields, null, 2)}</pre>
        </div></details>}
        {comparison.kind === "conflict" && <label className="merge-field"><Trans>Merged Markdown
          <textarea className="mdbase-field" rows={12} value={merged} onChange={(event) => setMerge({ ...merge, text: event.target.value })} />
          <span className="muted small">The merged text keeps your local setting changes on top of the collection version.</span>
        </Trans></label>}
        {!canRestore && <p><Trans>This record was deleted. Download the local draft to preserve it; it cannot be restored into a deleted record.</Trans></p>}
        <div className="compare-actions">
          <button type="button" className="mdbase-button" onClick={onDownload}><Trans>Download local draft</Trans></button>
          <button type="button" className="mdbase-button" onClick={() => onResolve("theirs")}><Trans>Use collection version</Trans></button>
          <button type="button" className="mdbase-button" disabled={!canRestore} onClick={() => onResolve("mine")}>{comparison.kind === "draft" ? t`Restore local draft` : t`Keep mine`}</button>
          {comparison.kind === "conflict" && <button type="button" className="mdbase-button is-primary" onClick={() => onResolve({ body: merged })}><Trans>Save merged version</Trans></button>}
        </div>
      </>}
    </Dialog>
  );
}
