// Citing from what you have read: search the Reader library by author, title,
// year or key; cite a source at the cursor, or insert a quotation you
// highlighted in Reader with its citation and page already filled in.
import { parseCiteItem } from "@mdbase-writer/core/cite-items";
import { useEffect, useMemo, useRef, useState } from "react";

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

/** A request to show one source (from the editor), or to focus the search; a new nonce repeats it. */
export interface SourcesRequest {
  readonly key?: string;
  readonly nonce: number;
}

export function SourcesPanel({
  library,
  cited,
  loadAnnotations,
  onInsert,
  canInsert,
  request,
}: {
  library: readonly LibraryEntry[];
  /** How often the manuscript cites each source. */
  cited: ReadonlyMap<string, number>;
  loadAnnotations(): Promise<Result<SourceAnnotation[]>>;
  onInsert(text: string): void;
  canInsert: boolean;
  request?: SourcesRequest | null;
}) {
  const [query, setQuery] = useState("");
  const [onlyCited, setOnlyCited] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<SourceAnnotation[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const pool = useMemo(() => (onlyCited ? library.filter((e) => cited.has(e.key)) : library), [library, cited, onlyCited]);
  // A short list until the writer searches; the panel scrolls as a whole.
  const results = useMemo(() => searchLibrary(pool, query, query.trim() ? 60 : onlyCited ? pool.length : 12), [pool, query, onlyCited]);

  // Show the requested source (opened, at the top of the list), or focus the search.
  useEffect(() => {
    if (!request) return;
    if (!request.key) {
      search.current?.focus();
      search.current?.select();
      return;
    }
    setOnlyCited(false);
    setQuery(request.key);
    setOpen(request.key);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(".source-row")?.focus());
  }, [request]);

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
        <p className="muted small">
          No sources in this collection yet. Add them in mdbase Reader; cite them here with <code>[@citekey]</code>.
        </p>
      </section>
    );
  }

  return (
    <section className="sources" aria-label="Sources">
      <input ref={search} className="mdbase-field" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Author, title, year or key" aria-label="Find a source" />
      <div className="segmented small" role="group" aria-label="Show">
        <button type="button" aria-pressed={!onlyCited} onClick={() => setOnlyCited(false)}>
          All <span className="count">{library.length}</span>
        </button>
        <button type="button" aria-pressed={onlyCited} onClick={() => setOnlyCited(true)}>
          Cited <span className="count">{cited.size}</span>
        </button>
      </div>
      <ul ref={list}>
        {results.map((entry) => {
          const expanded = open === entry.key;
          const uses = cited.get(entry.key) ?? 0;
          // Reader links a source by its path; a bare file name also matches.
          const notes = expanded ? (annotations ?? []).filter((a) => a.source === entry.path || entry.path.endsWith(`/${a.source}`)) : [];
          return (
            <li key={entry.key} className={expanded ? "is-open" : undefined}>
              <div className="source-line">
                <button type="button" className="source-row" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : entry.key)}>
                  <span className="source-title">{entry.title}</span>
                  <span className="source-meta">
                    {authorYear(entry)} · <code>{entry.key}</code>
                    {uses > 0 && <span className="cited-mark" title={`Cited ${uses} ${uses === 1 ? "time" : "times"} in this manuscript`}>cited{uses > 1 ? ` ×${uses}` : ""}</span>}
                  </span>
                </button>
                <button type="button" className="mdbase-button cite-button" disabled={!canInsert} onClick={() => onInsert(citationFor(entry.key))} aria-label={`Cite ${entry.title}`} title={`Insert [@${entry.key}] at the cursor`}>
                  Cite
                </button>
              </div>
              {expanded && (
                <div className="source-detail">
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
      {results.length === 0 && <p className="muted small">{onlyCited && !query ? "Nothing cited yet." : `Nothing matches “${query}”.`}</p>}
    </section>
  );
}
