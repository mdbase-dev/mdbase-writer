// Citing from what you have read: the sources this manuscript cites, then the
// rest of the Reader library; search by author, title, year or key. Cite a
// source at the cursor (with a page if you like), step through where it is
// cited, or insert a quotation you highlighted in Reader with its citation
// and page already filled in.
import { parseCiteItem } from "@mdbase-writer/core/cite-items";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { LibraryEntry, Result, SourceAnnotation } from "../backend/types.js";
import { authorYear, searchLibrary } from "../editor/library-search.js";
import { ChevronLeft, ChevronRight, ExternalIcon, SearchIcon } from "./icons.js";

/** Quotations up to this many words go inline; longer ones become block quotes (as most styles ask). */
const INLINE_QUOTE_WORDS = 40;
/** Library sources listed before "Show all". */
const LIBRARY_PREVIEW = 20;

/** The citation for a source, with Reader's locator when it reads as one ("p. 12"). */
export function citationFor(key: string, locator?: string): string {
  const parsed = locator ? parseCiteItem(`@${key}, ${locator}`) : null;
  return parsed?.locator ? `[@${key}, ${locator}]` : `[@${key}]`;
}

/** The citation for a locator the writer typed: a bare number or range is a page ("12" → "p. 12"). */
export function citationAt(key: string, typed: string): string {
  const locator = typed.trim();
  if (!locator) return `[@${key}]`;
  return `[@${key}, ${/^\d/.test(locator) ? `p. ${locator}` : locator}]`;
}

/** Markdown for a quotation from an annotation: inline in quotation marks, or a block quote. */
export function quotationFor(key: string, annotation: Pick<SourceAnnotation, "quote" | "locator">): string {
  const quote = (annotation.quote ?? "").replace(/\s+/g, " ").trim();
  const cite = citationFor(key, annotation.locator);
  if (quote.split(" ").length <= INLINE_QUOTE_WORDS) return `“${quote}” ${cite}`;
  return `\n\n> ${quote} ${cite}\n\n`;
}

/** A request to show one source (from the editor), or to search (for a passage, or afresh); a new nonce repeats it. */
export interface SourcesRequest {
  readonly key?: string;
  readonly query?: string;
  readonly nonce: number;
}

const byAuthorYear = (a: LibraryEntry, b: LibraryEntry) => authorYear(a).localeCompare(authorYear(b)) || a.title.localeCompare(b.title);

export function SourcesPanel({
  library,
  cited,
  atCursor,
  loadAnnotations,
  onInsert,
  onStepCitation,
  sourceHref,
  canInsert,
  request,
}: {
  library: readonly LibraryEntry[];
  /** How often the manuscript cites each source, in the order of first citation. */
  cited: ReadonlyMap<string, number>;
  /** The source cited under the editor's cursor. */
  atCursor?: string | null;
  loadAnnotations(): Promise<Result<SourceAnnotation[]>>;
  onInsert(text: string): void;
  /** Moves the editor to the next (1) or previous (-1) citation of a source. */
  onStepCitation(key: string, direction: 1 | -1): void;
  /** Where the source opens in Reader, when it can. */
  sourceHref?(entry: LibraryEntry): string | undefined;
  canInsert: boolean;
  request?: SourcesRequest | null;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [allLibrary, setAllLibrary] = useState(false);
  const [annotations, setAnnotations] = useState<SourceAnnotation[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLElement>(null);

  const byKey = useMemo(() => new Map(library.map((e) => [e.key, e])), [library]);
  const inManuscript = useMemo(() => [...cited.keys()].map((k) => byKey.get(k)).filter((e): e is LibraryEntry => Boolean(e)), [cited, byKey]);
  const rest = useMemo(() => library.filter((e) => !cited.has(e.key)).sort(byAuthorYear), [library, cited]);
  const results = useMemo(() => (query.trim() ? searchLibrary(library, query, 60) : []), [library, query]);

  const rowFor = (key: string) => panel.current?.querySelector<HTMLElement>(`.source-row[data-key="${CSS.escape(key)}"]`);

  // Show the requested source (opened, in its group or as a search), or focus the search.
  useEffect(() => {
    if (!request) return;
    if (!request.key) {
      if (request.query !== undefined) {
        setQuery(request.query);
        setOpen(null);
      }
      search.current?.focus();
      search.current?.select();
      return;
    }
    const key = request.key;
    setQuery(cited.has(key) ? "" : key);
    setOpen(key);
    requestAnimationFrame(() => rowFor(key)?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new request moves focus
  }, [request]);

  // The source under the cursor stays in view.
  useEffect(() => {
    if (atCursor) rowFor(atCursor)?.scrollIntoView({ block: "nearest" });
  }, [atCursor]);

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

  // Arrow keys (and j/k) move between sources; Enter cites; → and ← open and close.
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    const row = (e.target as HTMLElement).closest<HTMLElement>(".source-row");
    if (!row) return;
    const rows = [...(panel.current?.querySelectorAll<HTMLElement>(".source-row") ?? [])];
    const at = rows.indexOf(row);
    const key = row.dataset["key"] ?? "";
    if (e.key === "ArrowDown" || e.key === "j") rows[at + 1]?.focus();
    else if (e.key === "ArrowUp" || e.key === "k") (rows[at - 1] ?? search.current)?.focus();
    else if (e.key === "ArrowRight") setOpen(key);
    else if (e.key === "ArrowLeft") setOpen((o) => (o === key ? null : o));
    else if (e.key === "Enter" && canInsert) onInsert(citationFor(key));
    else return;
    e.preventDefault();
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") panel.current?.querySelector<HTMLElement>(".source-row")?.focus();
    else if (e.key === "Enter" && results[0] && canInsert) onInsert(citationFor(results[0].key));
    else return;
    e.preventDefault();
  };

  if (!library.length) {
    return (
      <section className="sources" aria-label="Sources">
        <p className="muted small">
          No sources in this collection yet. Add them in mdbase Reader; cite them here with <code>[@citekey]</code>.
        </p>
      </section>
    );
  }

  const row = (entry: LibraryEntry) => (
    <SourceRow
      key={entry.key}
      entry={entry}
      uses={cited.get(entry.key) ?? 0}
      here={entry.key === atCursor}
      expanded={open === entry.key}
      onToggle={() => setOpen(open === entry.key ? null : entry.key)}
      annotations={annotations}
      problem={problem}
      canInsert={canInsert}
      onInsert={onInsert}
      onStep={(direction) => onStepCitation(entry.key, direction)}
      href={sourceHref?.(entry)}
    />
  );
  const shownRest = allLibrary ? rest : rest.slice(0, LIBRARY_PREVIEW);

  return (
    <section ref={panel} className="sources" aria-label="Sources" onKeyDown={onListKey}>
      <div className="sources-search">
        <SearchIcon />
        <input
          ref={search}
          className="mdbase-field"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder="Search by author, title, year or key"
          aria-label="Find a source"
          aria-describedby="sources-keys"
        />
      </div>
      <span id="sources-keys" className="visually-hidden">Down arrow moves to the sources; Enter cites the first match.</span>
      {query.trim() ? (
        <div className="source-group">
          <ul aria-label="Matching sources">{results.map(row)}</ul>
          {results.length === 0 && <p className="muted small">Nothing matches “{query}”.</p>}
        </div>
      ) : (
        <>
          <div className="source-group">
            <h3 className="sidebar-heading" id="sources-cited">
              In this manuscript <span className="heading-count">{inManuscript.length}</span>
            </h3>
            {inManuscript.length ? <ul aria-labelledby="sources-cited">{inManuscript.map(row)}</ul> : <p className="muted small">Nothing cited yet. Cite a source below, or type <code>[@</code> in the editor.</p>}
          </div>
          {rest.length > 0 && (
            <div className="source-group">
              <h3 className="sidebar-heading" id="sources-library">
                Library <span className="heading-count">{rest.length}</span>
              </h3>
              <ul aria-labelledby="sources-library">{shownRest.map(row)}</ul>
              {rest.length > shownRest.length && (
                <button type="button" className="sidebar-more" onClick={() => setAllLibrary(true)}>
                  Show all {rest.length}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SourceRow({
  entry,
  uses,
  here,
  expanded,
  onToggle,
  annotations,
  problem,
  canInsert,
  onInsert,
  onStep,
  href,
}: {
  entry: LibraryEntry;
  uses: number;
  here: boolean;
  expanded: boolean;
  onToggle(): void;
  annotations: SourceAnnotation[] | null;
  problem: string | null;
  canInsert: boolean;
  onInsert(text: string): void;
  onStep(direction: 1 | -1): void;
  href: string | undefined;
}) {
  const [locator, setLocator] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);
  // Reader links a source by its path; a bare file name also matches.
  const notes = expanded ? (annotations ?? []).filter((a) => a.source === entry.path || entry.path.endsWith(`/${a.source}`)) : [];
  const detail = `source-${entry.key}`;

  return (
    <li className={[expanded && "is-open", here && "is-here"].filter(Boolean).join(" ") || undefined}>
      <div className="source-line">
        <button type="button" className="source-row" data-key={entry.key} aria-expanded={expanded} aria-controls={expanded ? detail : undefined} onClick={onToggle} title={`${entry.title} · @${entry.key}`}>
          <span className="source-title">{entry.title}</span>
          <span className="source-meta">
            {authorYear(entry) || entry.key}
            {uses > 0 && <span className="source-uses" title="In this manuscript">{uses === 1 ? "cited once" : `cited ${uses}×`}</span>}
          </span>
        </button>
        <button type="button" className="cite-button" hidden={expanded} disabled={!canInsert} tabIndex={-1} onClick={() => onInsert(citationFor(entry.key))} aria-label={`Cite ${entry.title}`} title={`Insert [@${entry.key}] at the cursor (Enter)`}>
          Cite
        </button>
      </div>
      {expanded && (
        <div className="source-detail" id={detail}>
          <form
            className="cite-at"
            onSubmit={(e) => {
              e.preventDefault();
              onInsert(citationAt(entry.key, locator));
              setLocator("");
            }}
          >
            <input
              className="mdbase-field"
              value={locator}
              onChange={(e) => setLocator(e.target.value)}
              placeholder="Page (optional)"
              aria-label={`Page or locator for ${entry.title}`}
              title="A page (12, 12–14) or a locator (ch. 3, sec. 2)"
            />
            <button type="submit" className="mdbase-button is-primary" disabled={!canInsert}>
              Cite{locator.trim() ? ` at ${/^\d/.test(locator.trim()) ? `p. ${locator.trim()}` : locator.trim()}` : ""}
            </button>
          </form>
          <div className="source-facts">
            {uses > 0 ? (
              <span className="source-uses-nav">
                <button type="button" className="mdbase-icon-button is-small" onClick={() => onStep(-1)} aria-label="Previous citation" title="Previous citation"><ChevronLeft /></button>
                <span className="small">Cited {uses === 1 ? "once" : `${uses} times`}</span>
                <button type="button" className="mdbase-icon-button is-small" onClick={() => onStep(1)} aria-label="Next citation" title="Next citation"><ChevronRight /></button>
              </span>
            ) : (
              <span className="muted small">Not cited yet</span>
            )}
            <span className="source-links">
              <button
                type="button"
                className="text-button"
                title={`@${entry.key}`}
                onClick={() => {
                  void navigator.clipboard?.writeText(entry.key).then(() => setCopied(true));
                }}
              >
                {copied ? "Copied" : "Copy key"}
              </button>
              {href && (
                <a className="text-button" href={href} target="_blank" rel="noopener">
                  Open in Reader <ExternalIcon />
                </a>
              )}
            </span>
          </div>
          {annotations === null && <p className="muted small" role="status">Loading annotations…</p>}
          {problem && <p className="muted small">Annotations unavailable: {problem}</p>}
          {notes.length > 0 && (
            <ul className="annotations" aria-label="Highlights from Reader">
              {notes.map((a) => (
                <li key={a.path}>
                  {a.quote && <blockquote>{a.quote}</blockquote>}
                  {a.note && <p className="small">{a.note}</p>}
                  <div className="annotation-actions">
                    {a.locator && <span className="muted small">{a.locator}</span>}
                    <button type="button" className="text-button" disabled={!canInsert} onClick={() => onInsert(a.quote ? quotationFor(entry.key, a) : citationFor(entry.key, a.locator))}>
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
}
