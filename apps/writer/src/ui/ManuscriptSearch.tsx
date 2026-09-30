// Search across the whole manuscript, at the top of the outline. While the
// field has text, matches grouped by record take the outline's place; a click
// goes to a match, and Enter / Shift-Enter step through them from the field.
import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import type { RecordView } from "../workspace/workspace.js";
import { SearchIcon } from "./icons.js";
import { formatCount, plural } from "./records.js";
import { searchManuscript, type SearchHit } from "./search.js";

/** A request to focus the field (Mod-Shift-F); a new nonce repeats it. */
export interface SearchRequest {
  readonly nonce: number;
}

export function ManuscriptSearch({
  query,
  onQuery,
  order,
  records,
  recordTitle,
  onGo,
  request,
}: {
  query: string;
  onQuery(query: string): void;
  /** Every record in reading order, the manuscript first. */
  order: readonly string[];
  records: ReadonlyMap<string, RecordView>;
  recordTitle(path: string): string;
  /** Goes to a match; `focus` moves focus into the editor. */
  onGo(hit: SearchHit, focus: boolean): void;
  request: SearchRequest | null;
}) {
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(-1);
  // Searching trails typing in the field (and in the editor) slightly.
  const searched = useDeferredValue(query);
  const result = useMemo(() => searchManuscript(searched, order, (path) => records.get(path)?.snapshot.body), [searched, order, records]);
  const hits = useMemo(() => result.groups.flatMap((g) => g.hits), [result]);

  useEffect(() => setCurrent(-1), [searched]);
  useEffect(() => {
    if (!request) return;
    field.current?.focus();
    field.current?.select();
  }, [request]);

  const go = (index: number, focus: boolean) => {
    const hit = hits[index];
    if (!hit) return;
    setCurrent(index);
    onGo(hit, focus);
    if (!focus) list.current?.querySelector(`[data-hit="${index}"]`)?.scrollIntoView({ block: "nearest" });
  };

  const onFieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && hits.length) go(e.shiftKey ? (current <= 0 ? hits.length - 1 : current - 1) : (current + 1) % hits.length, false);
    else if (e.key === "ArrowDown" && hits.length) list.current?.querySelector<HTMLElement>(".search-hit")?.focus();
    else if (e.key === "Escape" && query) onQuery("");
    else return;
    e.preventDefault();
  };
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    const rows = [...(list.current?.querySelectorAll<HTMLElement>(".search-hit") ?? [])];
    const at = rows.indexOf(e.target as HTMLElement);
    if (at < 0) return;
    if (e.key === "ArrowDown") rows[at + 1]?.focus();
    else if (e.key === "ArrowUp") (rows[at - 1] ?? field.current)?.focus();
    else if (e.key === "Escape") field.current?.focus();
    else return;
    e.preventDefault();
  };

  const listed = hits.length;
  let index = 0;
  return (
    <>
      <div className="manuscript-search" role="search">
        <SearchIcon />
        <input
          ref={field}
          className="mdbase-field"
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={onFieldKey}
          placeholder="Search the manuscript"
          aria-label="Search the manuscript"
          aria-describedby="manuscript-search-keys"
        />
      </div>
      <span id="manuscript-search-keys" className="visually-hidden">Enter and Shift-Enter go to the next and previous match; Down arrow moves to the matches.</span>
      {query.trim() && (
        <div ref={list} className="search-results" onKeyDown={onListKey}>
          <p className="search-summary muted small" role="status">
            {result.total === 0
              ? `Nothing matches “${query.trim()}”.`
              : result.truncated
                ? `The first ${formatCount(listed)} of ${plural(result.total, "match", "matches")}`
                : `${plural(result.total, "match", "matches")}${result.groups.length > 1 ? ` in ${plural(result.groups.length, "record")}` : ""}`}
          </p>
          {result.groups.map((group) => (
            <section key={group.record} className="search-group" aria-label={recordTitle(group.record)}>
              <h3 className="sidebar-heading" title={group.record}>
                {recordTitle(group.record)} <span className="heading-count">{group.hits.length}</span>
              </h3>
              <ul>
                {group.hits.map((hit) => {
                  const i = index++;
                  return (
                    <li key={hit.from}>
                      <button type="button" className="search-hit" data-hit={i} aria-current={i === current ? "true" : undefined} onClick={() => go(i, true)}>
                        {hit.before}
                        <mark>{hit.match}</mark>
                        {hit.after}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
