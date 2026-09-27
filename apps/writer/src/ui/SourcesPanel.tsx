// Citing from what you have read: search the Reader library by author, title,
// year or key; cite a source at the cursor, or insert a quotation you
// highlighted in Reader with its citation and page already filled in.
import { parseCiteItem } from "@mdbase-writer/core/cite-items";
import { useEffect, useMemo, useState } from "react";

import type { LibraryEntry, Result, SourceAnnotation } from "../backend/types.js";
import { authorYear, searchLibrary } from "../editor/library-search.js";

/** Quotations up to this many words go inline; longer ones become block quotes (as most styles ask). */
const INLINE_QUOTE_WORDS = 40;

/** The citation for a source, with Reader's locator when it reads as one ("p. 12"). */
export function citationFor(key: string, locator?: string): string {
  const parsed = locator ? parseCiteItem(`@${key}, ${locator}`) : null;
  return parsed?.locator ? `[@${key}, ${locator}]` : `[@${key}]`;
}

/** Markdown for a quotation from an annotation: inline in quotation marks, or a block quote. */
export function quotationFor(key: string, annotation: Pick<SourceAnnotation, "quote" | "locator">): string {
  const quote = (annotation.quote ?? "").replace(/\s+/g, " ").trim();
  const cite = citationFor(key, annotation.locator);
  if (quote.split(" ").length <= INLINE_QUOTE_WORDS) return `“${quote}” ${cite}`;
  return `\n\n> ${quote} ${cite}\n\n`;
}

export function SourcesPanel({
  library,
  loadAnnotations,
  onInsert,
  canInsert,
}: {
  library: readonly LibraryEntry[];
  loadAnnotations(): Promise<Result<SourceAnnotation[]>>;
  onInsert(text: string): void;
  canInsert: boolean;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<SourceAnnotation[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // A short list until the writer searches; the outline scrolls as a whole.
  const results = useMemo(() => searchLibrary(library, query, query.trim() ? 40 : 8), [library, query]);

  // Annotations load the first time a source is opened.
  useEffect(() => {
    if (!open || annotations) return;
    let live = true;
    void loadAnnotations().then((r) => {
      if (!live) return;
      if (r.ok) setAnnotations(r.value);
      else {
        setAnnotations([]);
        setProblem(r.message);
      }
    });
    return () => {
      live = false;
    };
  }, [open, annotations, loadAnnotations]);

  if (!library.length) {
    return (
      <section className="sources" aria-label="Sources">
        <h2>Sources</h2>
        <p className="muted small">
          No sources in this collection yet. Add them in mdbase Reader; cite them here with <code>[@citekey]</code>.
        </p>
      </section>
    );
  }

  return (
    <section className="sources" aria-label="Sources">
      <h2>
        Sources <span className="count">{library.length}</span>
      </h2>
      <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Author, title, year or key" aria-label="Find a source" />
      <ul>
        {results.map((entry) => {
          const expanded = open === entry.key;
          // Reader links a source by its path; a bare file name also matches.
          const notes = expanded ? (annotations ?? []).filter((a) => a.source === entry.path || entry.path.endsWith(`/${a.source}`)) : [];
          return (
            <li key={entry.key} className={expanded ? "is-open" : undefined}>
              <button type="button" className="source-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : entry.key)}>
                <span className="source-title">{entry.title}</span>
                <span className="source-meta">
                  {authorYear(entry)} · <code>{entry.key}</code>
                </span>
              </button>
              {expanded && (
                <div className="source-detail">
                  <button type="button" className="button" disabled={!canInsert} onClick={() => onInsert(citationFor(entry.key))}>
                    Cite
                  </button>
                  {annotations === null && <p className="muted small" role="status">Loading annotations…</p>}
                  {annotations !== null && notes.length === 0 && <p className="muted small">{problem ? `Annotations unavailable: ${problem}` : "No annotations from Reader."}</p>}
                  {notes.length > 0 && (
                    <ul className="annotations">
                      {notes.map((a) => (
                        <li key={a.path}>
                          {a.quote && <blockquote>{a.quote}</blockquote>}
                          {a.note && <p className="small">{a.note}</p>}
                          <div className="annotation-actions">
                            {a.locator && <span className="muted small">{a.locator}</span>}
                            <button type="button" className="link" disabled={!canInsert} onClick={() => onInsert(a.quote ? quotationFor(entry.key, a) : citationFor(entry.key, a.locator))}>
                              {a.quote ? "Insert quotation" : "Cite here"}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {results.length === 0 && <p className="muted small">Nothing matches “{query}”.</p>}
    </section>
  );
}
