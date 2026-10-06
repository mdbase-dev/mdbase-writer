// Problems listed under the editor, in reading order, each with where it is:
// the record and line, or the setting. It stays open while they are fixed;
// a row goes to the problem, F8 steps through them.
import { memo, useMemo } from "react";

import type { WriterDiagnostic } from "../compile/protocol.js";
import { AlertIcon, CloseIcon } from "./icons.js";
import { plural } from "./records.js";

export interface ProblemRow {
  readonly diagnostic: WriterDiagnostic;
  readonly where: string;
}

/** Rows in reading order: settings first, then each record's problems by position. */
export function problemRows(diagnostics: readonly WriterDiagnostic[], order: readonly string[], body: (record: string) => string | undefined, title: (record: string) => string): ProblemRow[] {
  const lines = new Map<string, number[]>();
  const lineOf = (record: string, offset: number) => {
    let starts = lines.get(record);
    if (!starts) {
      starts = [0];
      const text = body(record) ?? "";
      for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
      lines.set(record, starts);
    }
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if ((starts[mid] ?? 0) <= offset) low = mid;
      else high = mid - 1;
    }
    return low + 1;
  };
  const rank = (d: WriterDiagnostic) => (d.field ? -1 : Math.max(0, order.indexOf(d.record))) * 1e9 + (d.field ? 0 : d.from);
  return [...diagnostics]
    .sort((a, b) => rank(a) - rank(b))
    .map((diagnostic) => ({
      diagnostic,
      where: diagnostic.field
        ? `Settings · ${diagnostic.field}`
        : order.length > 1
          ? `${title(diagnostic.record)} · line ${lineOf(diagnostic.record, diagnostic.from)}`
          : `Line ${lineOf(diagnostic.record, diagnostic.from)}`,
    }));
}

export const ProblemsStrip = memo(function ProblemsStrip({ diagnostics, order, body, title, current, onPick, onClose }: {
  diagnostics: readonly WriterDiagnostic[];
  order: readonly string[];
  body(record: string): string | undefined;
  title(record: string): string;
  /** The record open in the editor; its problems are listed first. */
  current: string;
  onPick(d: WriterDiagnostic): void;
  onClose(): void;
}) {
  const rows = useMemo(() => problemRows(diagnostics, order, body, title), [diagnostics, order, body, title]);
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  return (
    <section className="problems-strip" aria-label="Problems">
      <header className="problems-strip-header">
        <AlertIcon />
        <strong>{plural(diagnostics.length, "problem")}</strong>
        {errors > 0 && errors < diagnostics.length && <span className="muted">{plural(errors, "error")}, {plural(diagnostics.length - errors, "warning")}</span>}
        <span className="muted problems-strip-hint">F8 goes to the next</span>
        <button type="button" className="mdbase-icon-button is-small" aria-label="Hide problems" title="Hide problems" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <ul className="problems-strip-list">
        {rows.map(({ diagnostic: d, where }, i) => (
          <li key={`${d.record}:${d.from}:${i}`} className={d.record === current && !d.field ? "is-current" : undefined}>
            <button type="button" className={`problem-row severity-${d.severity}`} onClick={() => onPick(d)}>
              <span className="problem-text">{d.message}</span>
              <span className="record-path">{where}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
});
