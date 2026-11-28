import { Trans } from "@lingui/react/macro";
import { t, plural as icuPlural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { shortcutLabel } from "@mdbase-dev/ui/command-palette";
// The manuscript's outline: the manuscript and its word count, then its
// chapters (records embedded on lines of their own) in reading order, each
// with its headings. Chapters are dragged, or moved with Alt-↑/↓, to reorder
// them; a new chapter is added at the end.
import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";

import type { Result } from "../backend/types.js";
import type { WriterDiagnostic } from "../compile/protocol.js";
import { wordCount } from "../words.js";
import type { RecordView } from "../workspace/workspace.js";
import { useRowWindow } from "./paging.js";
import { ChatIcon, ChevronRight, GripIcon, PlusIcon } from "./icons.js";
import { headingAt, headings, sectionWords, withoutTitle, type OutlineHeading } from "./outline.js";
import { formatCount, plural as countLabel, recordTitle, STATE_LABEL, STATE_TONE } from "./records.js";

// Workspace preserves each unchanged chapter's view across edits to other records.
// A folded row and its expanded headings share the same parse of that view.
interface RecordOutline {
  readonly title: string;
  readonly all: readonly OutlineHeading[];
  readonly visible: readonly OutlineHeading[];
  sectionWords?: readonly number[];
}

const outlines = new WeakMap<RecordView, RecordOutline>();
function outlineFor(view: RecordView) {
  let outline = outlines.get(view);
  if (!outline) {
    const title = recordTitle(view, view.path);
    const all = headings(view.snapshot.body);
    outline = { title, all, visible: withoutTitle(all, title) };
    outlines.set(view, outline);
  }
  return outline;
}

const NO_HEADINGS: readonly OutlineHeading[] = [];

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
  onRename,
  commentOffsets,
}: {
  /** Gives a chapter a new title. */
  onRename?(path: string, title: string): Promise<Result<unknown>> | Result<unknown>;
  /** Where each record's open comment threads are anchored, for a quiet count by section. */
  commentOffsets?: ReadonlyMap<string, readonly number[]>;
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
  onAdd(title: string, intent: string): Promise<Result<string>>;
}) {
  useLingui();
  const [dragging, setDragging] = useState<number | null>(null);
  const [drop, setDrop] = useState<{ index: number; after: boolean } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  // A book's chapters fold their headings away, except the one being written.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const [renaming, setRenaming] = useState<string | null>(null);
  const shows = (path: string) => (path === active ? !expanded.has(`!${path}`) : expanded.has(path));
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

  const move = useCallback((from: number, to: number, view: RecordView | undefined) => {
    const path = chapters[from];
    if (to < 0 || to >= chapters.length || !path) return;
    refocus.current = path;
    onMove(from, to);
    setAnnouncement(t`Moved ${recordTitle(view, path)} to chapter ${to + 1} of ${chapters.length}.`);
  }, [chapters, onMove]);

  const reveal = window.reveal;
  const navigate = useCallback((event: KeyboardEvent, path: string, index: number, view: RecordView | undefined) => {
    const direction = event.key === "ArrowDown" || event.key === "j" ? 1 : event.key === "ArrowUp" || event.key === "k" ? -1 : 0;
    if (!direction) return;
    if (event.altKey) {
      if (index >= 0) { event.preventDefault(); move(index, index + direction, view); }
      return;
    }
    const rank = (recordRanks.get(path) ?? -1) + direction;
    const next = rest[rank];
    if (!next) return;
    event.preventDefault();
    reveal(rank);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`.record-row[data-path="${CSS.escape(next)}"]`)?.focus());
  }, [move, recordRanks, rest, reveal]);
  const finishRename = useCallback((path: string) => {
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`.record-row[data-path="${CSS.escape(path)}"]`)?.focus());
  }, []);
  const startDrag = useCallback((index: number) => setDragging(index), []);
  const endDrag = useCallback(() => { setDragging(null); setDrop(null); }, []);
  const markDrop = useCallback((index: number, after: boolean) => {
    setDrop(current => current?.index === index && current.after === after ? current : { index, after });
  }, []);
  const toggle = useCallback((path: string, wasExpanded: boolean) => {
    setExpanded(set => {
      const next = new Set(set);
      if (wasExpanded) {
        next.delete(path);
        if (path === active) next.add(`!${path}`);
      } else {
        next.add(path);
        next.delete(`!${path}`);
      }
      return next;
    });
  }, [active]);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    if (dragging !== null && drop) {
      const at = drop.index + (drop.after ? 1 : 0);
      const path = chapters[dragging];
      if (path) move(dragging, at > dragging ? at - 1 : at, records.get(path));
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
        <span className="record-words" title={t`In the whole manuscript; citations, code and math are not counted`}>{countLabel(words, "word")}</span>
      </button>
      <RecordHeadings view={mainView} path={main} cursor={cursor?.record === main ? cursor.offset : null} onJump={onJump} comments={commentOffsets?.get(main)} problems={byRecord.get(main)} />

      {rest.length > 0 && (
        <h2 className="sidebar-heading outline-chapters" id="outline-chapters"><Trans>
          Chapters <span className="heading-count">{chapters.filter(Boolean).length}</span>
        </Trans></h2>
      )}
      {rest.length > 0 && (
        <ol ref={list} className="records" aria-labelledby="outline-chapters" onDragOver={(e) => dragging !== null && e.preventDefault()} onDrop={onDrop}>
          {rest.slice(window.from, window.from + window.size).map(path => {
            const index = ranks.get(path) ?? -1;
            return <ChapterRow
              key={path}
              path={path}
              view={records.get(path)}
              index={index}
              active={path === active}
              expanded={shows(path)}
              cursor={cursor?.record === path ? cursor.offset : null}
              comments={commentOffsets?.get(path)}
              problems={byRecord.get(path)}
              renaming={renaming === path}
              dragging={dragging === index && index >= 0}
              dropClass={dragging !== null && drop?.index === index ? (drop.after ? "drop-after" : "drop-before") : ""}
              canDrop={dragging !== null && index >= 0}
              onOpen={onOpen}
              onJump={onJump}
              onNavigate={navigate}
              onToggle={toggle}
              onRename={onRename}
              onStartRename={setRenaming}
              onFinishRename={finishRename}
              onRenameFailure={setAnnouncement}
              onStartDrag={startDrag}
              onEndDrag={endDrag}
              onMarkDrop={markDrop}
            />;
          })}
        </ol>
      )}
      {window.from > 0 && <button type="button" className="sidebar-more" onClick={window.previous}><Trans>Show previous 50 chapters</Trans></button>}
      {rest.length > window.from + window.size && <button type="button" className="sidebar-more" onClick={window.more}><Trans>Show 50 more chapters · {rest.length}</Trans></button>}
      <AddChapter disabled={!mainView} onAdd={onAdd} onAdded={onOpen} />
      {!mainView && <p className="muted small" role="status"><Trans>The manuscript is still opening.</Trans></p>}
      <span className="visually-hidden" role="status">{announcement}</span>
    </div>
  );
}

const ChapterRow = memo(function ChapterRow({
  path, view, index, active, expanded, cursor, comments, problems, renaming, dragging, dropClass, canDrop,
  onOpen, onJump, onNavigate, onToggle, onRename, onStartRename, onFinishRename, onRenameFailure, onStartDrag, onEndDrag, onMarkDrop,
}: {
  path: string;
  view: RecordView | undefined;
  index: number;
  active: boolean;
  expanded: boolean;
  cursor: number | null;
  comments: readonly number[] | undefined;
  problems: readonly WriterDiagnostic[] | undefined;
  renaming: boolean;
  dragging: boolean;
  dropClass: string;
  canDrop: boolean;
  onOpen(path: string): void;
  onJump(path: string, offset: number): void;
  onNavigate(event: KeyboardEvent, path: string, index: number, view: RecordView | undefined): void;
  onToggle(path: string, expanded: boolean): void;
  onRename: ((path: string, title: string) => Promise<Result<unknown>> | Result<unknown>) | undefined;
  onStartRename(path: string | null): void;
  onFinishRename(path: string): void;
  onRenameFailure(message: string): void;
  onStartDrag(index: number): void;
  onEndDrag(): void;
  onMarkDrop(index: number, after: boolean): void;
}) {
  useLingui();
  const direct = index >= 0;
  const outline = view && outlineFor(view);
  const title = outline?.title ?? recordTitle(undefined, path);
  const openRename = () => { if (onRename && view) onStartRename(path); };
  return (
    <li
      className={[direct ? "" : "is-nested", dragging ? "is-dragging" : "", dropClass].filter(Boolean).join(" ") || undefined}
      draggable={direct}
      onDragStart={event => {
        if (!direct) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", path);
        onStartDrag(index);
      }}
      onDragEnd={onEndDrag}
      onDragOver={event => {
        if (!canDrop) return;
        event.preventDefault();
        const box = event.currentTarget.getBoundingClientRect();
        onMarkDrop(index, event.clientY > box.top + Math.min(box.height, 40) / 2);
      }}
    >
      {renaming && view ? (
        <RenameChapter
          title={title}
          onDone={async name => {
            onStartRename(null);
            if (name !== null && onRename) { const done = await onRename(path, name); if (!done.ok) onRenameFailure(done.message); }
            onFinishRename(path);
          }}
        />
      ) : (
        <div className="record-line">
          <button
            type="button"
            className="record-row"
            data-path={path}
            aria-current={active ? "true" : undefined}
            onClick={() => onOpen(path)}
            onDoubleClick={openRename}
            onKeyDown={event => {
              if (event.key === "F2") { event.preventDefault(); openRename(); }
              else onNavigate(event, path, index, view);
            }}
            title={[path, direct ? t`Drag, or ${shortcutLabel("alt+↑")} / ${shortcutLabel("alt+↓")}, to reorder` : null, onRename ? t`Double-click or F2 to rename` : null].filter(Boolean).join(" · ")}
          >
            <span className="record-number" aria-hidden={!direct}>
              <span className="record-index">{direct ? index + 1 : ""}</span>
              {direct && <GripIcon className="record-grip" />}
            </span>
            <span className="record-name">{title}</span>
            <RecordState view={view} problems={problems?.length ?? 0} comments={comments?.length ?? 0} />
            <span className="record-words">{view ? <Words body={view.snapshot.body} /> : ""}</span>
          </button>
          {!!outline?.visible.length && (
            <button type="button" className="record-fold" aria-expanded={expanded} aria-label={expanded ? t`Hide the headings of ${recordTitle(view, path)}` : t`Show the headings of ${recordTitle(view, path)}`} onClick={() => onToggle(path, expanded)}>
              <ChevronRight />
            </button>
          )}
        </div>
      )}
      {expanded && <RecordHeadings view={view} path={path} cursor={cursor} onJump={onJump} comments={comments} problems={problems} />}
    </li>
  );
});

function RecordState({ view, problems, comments = 0 }: { view: RecordView | undefined; problems: number; comments?: number }) {
  useLingui();
  const state = view?.snapshot.state;
  if ((!state || state === "saved") && !problems && !comments) return null;
  return (
    <span className="record-state">
      {state && state !== "saved" && <span className={`status tone-${STATE_TONE[state]}`} title={STATE_LABEL[state]}><span className="dot" aria-hidden="true" /><span className="visually-hidden">{STATE_LABEL[state]}</span></span>}
      {comments > 0 && <CommentCount count={comments} />}
      {problems > 0 && <span className="count tone-warning" title={countLabel(problems, "problem")}>{problems}</span>}
    </span>
  );
}

/** An open-comment count, kept as quiet as a word count. */
function CommentCount({ count }: { count: number }) {
  useLingui();
  return <span className="outline-comments" title={`${countLabel(count, "open comment")}`}><ChatIcon /><span>{count}</span></span>;
}

/** A chapter's title, edited in place: Enter keeps it, Escape leaves it. */
function RenameChapter({ title, onDone }: { title: string; onDone(title: string | null): void }) {
  useLingui();
  const [value, setValue] = useState(title);
  return (
    <form className="record-rename" onSubmit={(e) => { e.preventDefault(); onDone(value.trim() && value.trim() !== title ? value.trim() : null); }}>
      <input
        className="mdbase-field"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={() => onDone(value.trim() && value.trim() !== title ? value.trim() : null)}
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onDone(null); } }}
        aria-label={t`Chapter title`}
      />
    </form>
  );
}

/** A record's word count, counted again only when its text changes. */
const Words = memo(function Words({ body }: { body: string }) {
  useLingui();
  return formatCount(wordCount(body));
});

/**
 * A record's headings, less an opening heading that repeats its title. Only
 * the record being edited, or the one the cursor is in, renders as you type.
 */
const RecordHeadings = memo(function RecordHeadings({ view, path, cursor, onJump, comments, problems }: { view: RecordView | undefined; path: string; cursor: number | null; onJump(path: string, offset: number): void; comments?: readonly number[] | undefined; problems?: readonly WriterDiagnostic[] | undefined }) {
  useLingui();
  const outline = view && outlineFor(view);
  const all = outline?.all ?? NO_HEADINGS;
  const list = outline?.visible ?? NO_HEADINGS;
  // Folded rows never need section counts. Keep them for later expansions of
  // the same view once an expanded row has computed them.
  if (outline && view) outline.sectionWords ??= sectionWords(view.snapshot.body, all);
  const words = outline?.sectionWords;
  // What each section holds: the comments and problems anchored between its heading and the next of its level or higher.
  const counts = useMemo(() => all.map((h, i) => {
    const end = all.slice(i + 1).find((n) => n.level <= h.level)?.offset ?? Number.MAX_SAFE_INTEGER;
    const within = (offset: number) => offset >= h.offset && offset < end;
    return { comments: comments?.filter(within).length ?? 0, problems: problems?.filter((d) => !d.field && within(d.from)).length ?? 0 };
  }), [all, comments, problems]);
  const window = useRowWindow();
  const ranks = useMemo(() => new Map(all.map((h, i) => [h, i])), [all]);
  const here = cursor !== null ? headingAt(all, cursor) : undefined;
  const activeRow = useRef<HTMLButtonElement>(null);
  const headingList = useRef<HTMLOListElement>(null);
  const listRanks = useMemo(() => new Map(list.map((h, i) => [h.offset, i])), [list]);
  // Reveal a different logical row, not every new parse of the same row.
  // Re-enqueuing an unchanged page after each edit keeps synchronous work
  // pending while the workspace is updating and can exhaust React's limit.
  const activeRank = here ? listRanks.get(here.offset) ?? -1 : -1;
  useEffect(() => { window.reveal(activeRank); }, [activeRank, window.reveal]);
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
            {(counts[ranks.get(h)!]?.comments ?? 0) > 0 && <CommentCount count={counts[ranks.get(h)!]!.comments} />}
            {(counts[ranks.get(h)!]?.problems ?? 0) > 0 && <span className="heading-problem" title={countLabel(counts[ranks.get(h)!]!.problems, "problem")} />}
            <span className="heading-words" title={icuPlural(words?.[ranks.get(h)!] ?? 0, { one: "# word in this section", other: "# words in this section" })}>{formatCount(words?.[ranks.get(h)!] ?? 0)}</span>
          </button>
        </li>
      ))}
    </ol>
    {window.from > 0 && <button type="button" className="sidebar-more" onClick={window.previous}><Trans>Show previous 50 headings</Trans></button>}
    {list.length > window.from + window.size && <button type="button" className="sidebar-more" onClick={window.more}><Trans>Show 50 more headings · {list.length}</Trans></button>}
    </>
  );
});

function AddChapter({ disabled, onAdd, onAdded }: { disabled: boolean; onAdd(title: string, intent: string): Promise<Result<string>>; onAdded(path: string): void }) {
  useLingui();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  // One name per new chapter: a retry re-sends it, so the chapter lands once.
  const intent = useRef(crypto.randomUUID());

  if (!editing) {
    return (
      <button ref={opener} type="button" className="sidebar-more add-chapter" disabled={disabled} onClick={() => setEditing(true)}><Trans>
        <PlusIcon /> Add chapter
      </Trans></button>
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
        const added = await onAdd(title, intent.current);
        setBusy(false);
        if (!added.ok) return setProblem(added.message);
        intent.current = crypto.randomUUID();
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
        placeholder={t`Chapter title`}
        aria-label={t`New chapter title`}
        disabled={busy}
      />
      <div className="add-chapter-actions">
        <button type="submit" className="mdbase-button" disabled={busy || !title.trim()}>{busy ? t`Adding…` : t`Add`}</button>
        <button type="button" className="link small" onClick={close}><Trans>Cancel</Trans></button>
      </div>
      {problem && <p className="field-problem severity-error" role="alert">{problem}</p>}
    </form>
  );
}
