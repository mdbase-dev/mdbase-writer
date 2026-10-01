// The manuscript's outline: the manuscript and its word count, then its
// chapters (records embedded on lines of their own) in reading order, each
// with its headings. Chapters are dragged, or moved with Alt-↑/↓, to reorder
// them; a new chapter is added at the end.
import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import type { Result } from "../backend/types.js";
import type { WriterDiagnostic } from "../compile/protocol.js";
import { wordCount } from "../words.js";
import type { RecordView } from "../workspace/workspace.js";
import { useRowWindow } from "./paging.js";
import { GripIcon, PlusIcon } from "./icons.js";
import { headingAt, headings, sectionWords, withoutTitle } from "./outline.js";
import { formatCount, plural, recordTitle, STATE_LABEL, STATE_TONE } from "./records.js";

export function OutlinePanel({
  main,
  order,
  records,
  chapters,
  words,
  byRecord,
  active,
  cursor,
  onOpen,
  onJump,
  onMove,
  onAdd,
}: {
  main: string;
  /** Every record in reading order, the manuscript first. */
  order: readonly string[];
  records: ReadonlyMap<string, RecordView>;
  /** The record each of the manuscript's chapter embeds resolves to, in order. */
  chapters: readonly (string | null)[];
  /** Words in the whole manuscript. */
  words: number;
  byRecord: ReadonlyMap<string, readonly WriterDiagnostic[]>;
  active: string;
  cursor: { record: string; offset: number } | null;
  onOpen(path: string): void;
  onJump(path: string, offset: number): void;
  /** Moves the chapter embed at index `from` to index `to`. */
  onMove(from: number, to: number): void;
  onAdd(title: string): Promise<Result<string>>;
}) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ index: number; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const refocus = useRef<string | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const rest = useMemo(() => order.slice(1), [order]);
  const window = useRowWindow();
  const recordRanks = useMemo(() => new Map(rest.map((path, i) => [path, i])), [rest]);
  const ranks = useMemo(() => new Map(chapters.map((path, i) => [path, i] as const).reverse()), [chapters]);
  useEffect(() => window.reveal(rest.indexOf(active)), [active, rest]);

  // A chapter moved with the keyboard keeps focus once the outline has its new order.
  useEffect(() => {
    const path = refocus.current;
    if (!path) return;
    const row = list.current?.querySelector<HTMLElement>(`.record-row[data-path="${CSS.escape(path)}"]`);
    if (row && document.activeElement !== row) row.focus();
    refocus.current = null;
  }, [order]);

  const move = (from: number, to: number) => {
    const path = chapters[from];
    if (to < 0 || to >= chapters.length || !path) return;
    refocus.current = path;
    onMove(from, to);
    setAnnouncement(`Moved ${recordTitle(records.get(path), path)} to chapter ${to + 1} of ${chapters.length}.`);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragging !== null && drop) {
      const at = drop.index + (drop.after ? 1 : 0);
      move(dragging, at > dragging ? at - 1 : at);
    }
    setDragging(null);
    setDrop(null);
  };

  const mainView = records.get(main);
  return (
    <div className="outline-panel">
      <button type="button" className="outline-manuscript" aria-current={main === active ? "true" : undefined} onClick={() => onOpen(main)} title={main}>
        <span className="record-name">{recordTitle(mainView, main)}</span>
        <RecordState view={mainView} problems={byRecord.get(main)?.length ?? 0} />
        <span className="record-words" title="In the whole manuscript; citations, code and math are not counted">{plural(words, "word")}</span>
      </button>
      <RecordHeadings view={mainView} path={main} cursor={cursor?.record === main ? cursor.offset : null} onJump={onJump} />

      {rest.length > 0 && (
        <h3 className="sidebar-heading outline-chapters" id="outline-chapters">
          Chapters <span className="heading-count">{chapters.filter(Boolean).length}</span>
        </h3>
      )}
      {rest.length > 0 && (
        <ol ref={list} className="records" aria-labelledby="outline-chapters" onDragOver={(e) => dragging !== null && e.preventDefault()} onDrop={onDrop}>
          {rest.slice(window.from, window.from + window.size).map((path) => {
            const view = records.get(path);
            const index = ranks.get(path) ?? -1;
            const direct = index >= 0;
            const onKeyDown = (e: KeyboardEvent) => {
              const direction = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
              if (!direction) return;
              if (e.altKey) { if (direct) { e.preventDefault(); move(index, index + direction); } return; }
              const rank = (recordRanks.get(path) ?? -1) + direction, next = rest[rank];
              if (!next) return;
              e.preventDefault(); window.reveal(rank);
              requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`.record-row[data-path="${CSS.escape(next)}"]`)?.focus());
            };
            const onDragOver = (e: DragEvent<HTMLLIElement>) => {
              if (dragging === null || !direct) return;
              e.preventDefault();
              const box = e.currentTarget.getBoundingClientRect();
              const after = e.clientY > box.top + Math.min(box.height, 40) / 2;
              if (drop?.index !== index || drop.after !== after) setDrop({ index, after });
            };
            const dropClass = drop?.index === index && dragging !== null ? (drop.after ? "drop-after" : "drop-before") : "";
            return (
              <li
                key={path}
                className={[direct ? "" : "is-nested", dragging === index && direct ? "is-dragging" : "", dropClass].filter(Boolean).join(" ") || undefined}
                draggable={direct}
                onDragStart={(e) => {
                  if (!direct) return;
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", path);
                  setDragging(index);
                }}
                onDragEnd={() => {
                  setDragging(null);
                  setDrop(null);
                }}
                onDragOver={onDragOver}
              >
                <button
                  type="button"
                  className="record-row"
                  data-path={path}
                  aria-current={path === active ? "true" : undefined}
                  onClick={() => onOpen(path)}
                  onKeyDown={onKeyDown}
                  title={direct ? `${path} · drag, or Alt-↑/↓, to reorder` : path}
                >
                  <span className="record-number" aria-hidden={!direct}>
                    <span className="record-index">{direct ? index + 1 : ""}</span>
                    {direct && <GripIcon className="record-grip" />}
                  </span>
                  <span className="record-name">{recordTitle(view, path)}</span>
                  <RecordState view={view} problems={byRecord.get(path)?.length ?? 0} />
                  <span className="record-words">{view ? <Words body={view.snapshot.body} /> : ""}</span>
                </button>
                <RecordHeadings view={view} path={path} cursor={cursor?.record === path ? cursor.offset : null} onJump={onJump} />
              </li>
            );
          })}
        </ol>
      )}
      {window.from > 0 && <button type="button" className="sidebar-more" onClick={window.previous}>Show previous 50 chapters</button>}
      {rest.length > window.from + window.size && <button type="button" className="sidebar-more" onClick={window.more}>Show 50 more chapters · {rest.length}</button>}
      <AddChapter onAdd={onAdd} onAdded={onOpen} />
      <span className="visually-hidden" role="status">{announcement}</span>
    </div>
  );
}

function RecordState({ view, problems }: { view: RecordView | undefined; problems: number }) {
  const state = view?.snapshot.state;
  if ((!state || state === "saved") && !problems) return null;
  return (
    <span className="record-state">
      {state && state !== "saved" && <span className={`status tone-${STATE_TONE[state]}`} title={STATE_LABEL[state]}><span className="dot" aria-hidden="true" /><span className="visually-hidden">{STATE_LABEL[state]}</span></span>}
      {problems > 0 && <span className="count tone-warning" title={plural(problems, "problem")}>{problems}</span>}
    </span>
  );
}

/** A record's word count, counted again only when its text changes. */
const Words = memo(function Words({ body }: { body: string }) {
  return formatCount(wordCount(body));
});

/**
 * A record's headings, less an opening heading that repeats its title. Only
 * the record being edited, or the one the cursor is in, renders as you type.
 */
const RecordHeadings = memo(function RecordHeadings({ view, path, cursor, onJump }: { view: RecordView | undefined; path: string; cursor: number | null; onJump(path: string, offset: number): void }) {
  const body = view?.snapshot.body;
  const title = recordTitle(view, path);
  const all = useMemo(() => (body ? headings(body) : []), [body]);
  const words = useMemo(() => (body ? sectionWords(body, all) : []), [body, all]);
  const list = useMemo(() => withoutTitle(all, title), [all, title]);
  const window = useRowWindow();
  const ranks = useMemo(() => new Map(all.map((h, i) => [h, i])), [all]);
  const here = cursor !== null ? headingAt(all, cursor) : undefined;
  const activeRow = useRef<HTMLButtonElement>(null);
  const headingList = useRef<HTMLOListElement>(null);
  const listRanks = useMemo(() => new Map(list.map((h, i) => [h.offset, i])), [list]);
  useEffect(() => { window.reveal(here ? list.indexOf(here) : -1); }, [here?.offset, list]);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [here?.offset, window.from, window.size]);
  if (!list.length) return null;
  const top = Math.min(...list.map((h) => h.level));
  return (
    <><ol ref={headingList} className="headings">
      {list.slice(window.from, window.from + window.size).map((h) => (
        <li key={h.offset} style={{ paddingLeft: `${(h.level - top) * 0.75}rem` }}>
          <button
            ref={h === here ? activeRow : undefined}
            type="button"
            className="heading-row"
            data-heading={h.offset}
            onKeyDown={(e) => {
              const direction = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
              const rank = (listRanks.get(h.offset) ?? -1) + direction, next = list[rank];
              if (!direction || !next) return;
              e.preventDefault(); window.reveal(rank);
              requestAnimationFrame(() => headingList.current?.querySelector<HTMLElement>(`[data-heading="${next.offset}"]`)?.focus());
            }}
            aria-current={h === here ? "location" : undefined}
            onClick={() => onJump(path, h.offset)}
          >
            <span className="heading-text">{h.text}</span>
            <span className="heading-words" title={`${plural(words[ranks.get(h)!] ?? 0, "word")} in this section`}>{formatCount(words[ranks.get(h)!] ?? 0)}</span>
          </button>
        </li>
      ))}
    </ol>
    {window.from > 0 && <button type="button" className="sidebar-more" onClick={window.previous}>Show previous 50 headings</button>}
    {list.length > window.from + window.size && <button type="button" className="sidebar-more" onClick={window.more}>Show 50 more headings · {list.length}</button>}
    </>
  );
});

function AddChapter({ onAdd, onAdded }: { onAdd(title: string): Promise<Result<string>>; onAdded(path: string): void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);

  if (!editing) {
    return (
      <button ref={opener} type="button" className="sidebar-more add-chapter" onClick={() => setEditing(true)}>
        <PlusIcon /> Add chapter
      </button>
    );
  }
  const close = () => {
    setEditing(false);
    setTitle("");
    setProblem(null);
    requestAnimationFrame(() => opener.current?.focus());
  };
  return (
    <form
      className="add-chapter-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || busy) return;
        setBusy(true);
        const added = await onAdd(title);
        setBusy(false);
        if (!added.ok) return setProblem(added.message);
        close();
        onAdded(added.value);
      }}
    >
      <input
        className="mdbase-field"
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.preventDefault();
          close();
        }}
        placeholder="Chapter title"
        aria-label="New chapter title"
        disabled={busy}
      />
      <div className="add-chapter-actions">
        <button type="submit" className="mdbase-button" disabled={busy || !title.trim()}>{busy ? "Adding…" : "Add"}</button>
        <button type="button" className="link small" onClick={close}>Cancel</button>
      </div>
      {problem && <p className="field-problem severity-error" role="alert">{problem}</p>}
    </form>
  );
}
