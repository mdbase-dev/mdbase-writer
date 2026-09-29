// The manuscript's outline: the manuscript and its word count, then its
// chapters (records embedded on lines of their own) in reading order, each
// with its headings. Chapters are dragged, or moved with Alt-↑/↓, to reorder
// them; a new chapter is added at the end.
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import type { Result } from "../backend/types.js";
import type { WriterDiagnostic } from "../compile/protocol.js";
import { wordCount } from "../words.js";
import type { RecordView } from "../workspace/workspace.js";
import { PlusIcon } from "./icons.js";
import { headingAt, headings, sectionWords, withoutTitle } from "./outline.js";
import { plural, recordTitle, STATE_LABEL, STATE_TONE } from "./records.js";

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
  const rest = order.slice(1);

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
      <RecordHeadings view={mainView} path={main} cursor={cursor} onJump={(offset) => onJump(main, offset)} />

      {rest.length > 0 && (
        <ol ref={list} className="records" aria-label="Chapters" onDragOver={(e) => dragging !== null && e.preventDefault()} onDrop={onDrop}>
          {rest.map((path) => {
            const view = records.get(path);
            const index = chapters.indexOf(path);
            const direct = index >= 0;
            const onKeyDown = (e: KeyboardEvent) => {
              if (!direct || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
              e.preventDefault();
              move(index, index + (e.key === "ArrowUp" ? -1 : 1));
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
                  <span className="record-number" aria-hidden={!direct}>{direct ? index + 1 : ""}</span>
                  <span className="record-name">{recordTitle(view, path)}</span>
                  <RecordState view={view} problems={byRecord.get(path)?.length ?? 0} />
                  <span className="record-words">{view ? wordCount(view.snapshot.body).toLocaleString() : ""}</span>
                </button>
                <RecordHeadings view={view} path={path} cursor={cursor} onJump={(offset) => onJump(path, offset)} />
              </li>
            );
          })}
        </ol>
      )}
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

/** A record's headings, less an opening heading that repeats its title. */
function RecordHeadings({ view, path, cursor, onJump }: { view: RecordView | undefined; path: string; cursor: { record: string; offset: number } | null; onJump(offset: number): void }) {
  const body = view?.snapshot.body;
  const title = recordTitle(view, path);
  const all = useMemo(() => (body ? headings(body) : []), [body]);
  const words = useMemo(() => (body ? sectionWords(body, all) : []), [body, all]);
  const list = useMemo(() => withoutTitle(all, title), [all, title]);
  const here = cursor?.record === path ? headingAt(all, cursor.offset) : undefined;
  const activeRow = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [here?.offset]);
  if (!list.length) return null;
  const top = Math.min(...list.map((h) => h.level));
  return (
    <ol className="headings">
      {list.map((h) => (
        <li key={h.offset} style={{ paddingLeft: `${(h.level - top) * 0.75}rem` }}>
          <button
            ref={h === here ? activeRow : undefined}
            type="button"
            className="heading-row"
            aria-current={h === here ? "location" : undefined}
            onClick={() => onJump(h.offset)}
          >
            <span className="heading-text">{h.text}</span>
            <span className="heading-words" title={`${plural(words[all.indexOf(h)] ?? 0, "word")} in this section`}>{(words[all.indexOf(h)] ?? 0).toLocaleString()}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

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
