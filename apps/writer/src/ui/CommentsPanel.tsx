// Comments on the manuscript's records: threads in reading order, with
// replies, resolving, and suggested edits to accept or reject. A new comment
// starts from a passage chosen in the editor (the draft).
import type { CommentRecord, CommentThread } from "@mdbase-writer/core/comments";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { personName, type CommentChange, type People } from "../backend/comments.js";
import type { Result } from "../backend/types.js";
import { ALT_LABEL, MOD_LABEL } from "../editor/insight.js";
import type { CommentDraft } from "../workspace/workspace.js";
import { describeSuggestion, when, type PlacedThread } from "./comments.js";
import { plural } from "./records.js";

/** A passage chosen to comment on or suggest an edit to, or (without a draft) a whole record. */
export interface PendingComment {
  readonly kind: "comment" | "suggest";
  readonly record: string;
  readonly draft?: CommentDraft;
}

type Filter = "open" | "resolved";

export function CommentsPanel({
  placed,
  people,
  problem,
  active,
  pending,
  recordTitle,
  onSelect,
  onSubmit,
  onCancel,
  onReply,
  onChange,
  onAccept,
  onWholeRecord,
}: {
  placed: readonly PlacedThread[];
  people: People;
  /** Why comments could not be loaded. */
  problem?: string | undefined;
  /** The selected thread (its first comment's path). */
  active: string | null;
  pending: PendingComment | null;
  recordTitle(path: string): string;
  onSelect(placed: PlacedThread): void;
  onSubmit(text: string, replacement?: string): Promise<Result<unknown>>;
  onCancel(): void;
  onReply(thread: CommentThread, text: string): Promise<Result<unknown>>;
  onChange(comment: CommentRecord, change: CommentChange): Promise<Result<unknown>>;
  onAccept(placed: PlacedThread): Promise<Result<unknown>>;
  /** Starts a comment on the whole of the record in the editor. */
  onWholeRecord(): void;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const panel = useRef<HTMLElement>(null);
  const counts = { open: placed.filter((p) => p.thread.root.status === "open").length, resolved: placed.filter((p) => p.thread.root.status === "resolved").length };
  const shown = placed.filter((p) => p.thread.root.status === filter);

  // A thread selected in the editor comes into view (and shows, even when resolved).
  useEffect(() => {
    if (!active) return;
    const hit = placed.find((p) => p.thread.root.path === active);
    if (hit && hit.thread.root.status !== filter) setFilter(hit.thread.root.status);
    requestAnimationFrame(() => panel.current?.querySelector(`[data-thread="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new selection moves the list
  }, [active]);

  let lastRecord: string | null = null;
  return (
    <section ref={panel} className="comments" aria-label="Comments">
      {pending && <Composer key={`${pending.record}:${pending.draft?.from ?? "whole"}:${pending.kind}`} pending={pending} recordTitle={recordTitle} onSubmit={onSubmit} onCancel={onCancel} />}
      <div className="comments-bar">
        <div className="segmented" role="group" aria-label="Show">
          {(["open", "resolved"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "open" ? "Open" : "Resolved"} <span className="heading-count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="link small" onClick={onWholeRecord} title="Comment on the whole record in the editor">
          Comment on this record
        </button>
      </div>
      {problem && <p className="muted small">Comments unavailable: {problem}</p>}
      {!problem && !shown.length && (
        <p className="muted small">
          {filter === "open" ? <>No open comments. Select text and press <kbd>{MOD_LABEL}-{ALT_LABEL}-M</kbd> to comment, or <kbd>{MOD_LABEL}-{ALT_LABEL}-S</kbd> to suggest an edit.</> : "Nothing resolved yet."}
        </p>
      )}
      <ul className="threads">
        {shown.map((p) => {
          const heading = p.record !== lastRecord ? <li className="threads-record" key={`h:${p.record}`}><h3 className="sidebar-heading">{recordTitle(p.record)}</h3></li> : null;
          lastRecord = p.record;
          return [
            heading,
            <Thread
              key={p.thread.root.path}
              placed={p}
              people={people}
              active={p.thread.root.path === active}
              onSelect={() => onSelect(p)}
              onReply={(text) => onReply(p.thread, text)}
              onChange={onChange}
              onAccept={() => onAccept(p)}
            />,
          ];
        })}
      </ul>
    </section>
  );
}

/** Runs an action, showing it is busy and what went wrong. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<Result<unknown>>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setError(result.message);
    return result.ok;
  };
  return { busy, error, run };
}

function Composer({ pending, recordTitle, onSubmit, onCancel }: { pending: PendingComment; recordTitle(path: string): string; onSubmit(text: string, replacement?: string): Promise<Result<unknown>>; onCancel(): void }) {
  const { draft, kind } = pending;
  const quote = draft ? draft.body.slice(draft.from, draft.to) : "";
  const [text, setText] = useState("");
  const [replacement, setReplacement] = useState(quote);
  const first = useRef<HTMLTextAreaElement>(null);
  const { busy, error, run } = useAction();
  useEffect(() => first.current?.focus(), []);
  const suggest = kind === "suggest";
  const empty = suggest ? replacement === quote : !text.trim();
  const submit = () => void run(() => onSubmit(text, suggest ? replacement : undefined));
  return (
    <form
      className="thread composer is-active"
      onSubmit={(e) => {
        e.preventDefault();
        if (!empty) submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
        else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !empty) {
          e.preventDefault();
          submit();
        }
      }}
    >
      <p className="thread-record small muted">{suggest ? "Suggest an edit" : "Comment"} · {recordTitle(pending.record)}</p>
      {quote ? <blockquote className="thread-quote">{quote}</blockquote> : <p className="thread-quote muted small">{draft ? (suggest ? "Insert at the cursor" : "At the cursor") : "On the whole record"}</p>}
      {suggest && (
        <label className="composer-field">
          <span className="small">Replace with</span>
          <textarea ref={first} className="mdbase-field" rows={3} value={replacement} onChange={(e) => setReplacement(e.target.value)} aria-label="Suggested text" />
        </label>
      )}
      <textarea
        ref={suggest ? undefined : first}
        className="mdbase-field"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={suggest ? "Why (optional)" : "Comment"}
        aria-label={suggest ? "Reason for the suggestion" : "Comment"}
      />
      {error && <p className="small tone-danger" role="alert">{error}</p>}
      <div className="thread-actions">
        <button type="submit" className="mdbase-button is-primary" disabled={busy || empty} title={`${MOD_LABEL}-Enter`}>
          {suggest ? "Suggest" : "Comment"}
        </button>
        <button type="button" className="mdbase-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Thread({
  placed,
  people,
  active,
  onSelect,
  onReply,
  onChange,
  onAccept,
}: {
  placed: PlacedThread;
  people: People;
  active: boolean;
  onSelect(): void;
  onReply(text: string): Promise<Result<unknown>>;
  onChange(comment: CommentRecord, change: CommentChange): Promise<Result<unknown>>;
  onAccept(): Promise<Result<unknown>>;
}) {
  const { thread, at } = placed;
  const { root } = thread;
  const [reply, setReply] = useState("");
  const [replying, setReplying] = useState(false);
  const { busy, error, run } = useAction();
  const suggestion = root.motivation === "editing" && root.suggestion ? root.suggestion : null;
  const open = root.status === "open";
  const mine = (c: CommentRecord) => !c.createdBy || (people.me !== undefined && c.createdBy.toLowerCase() === people.me.link.toLowerCase());

  const outcome = suggestion?.outcome === "accepted" ? "Accepted" : suggestion?.outcome === "rejected" ? "Rejected" : "Resolved";
  const resolvedNote = !open ? `${suggestion ? outcome : "Resolved"}${root.resolvedBy ? ` by ${personName(root.resolvedBy, people)}` : ""}${root.resolvedAt ? ` ${when(root.resolvedAt)}` : ""}` : null;

  return (
    <li className={`thread${active ? " is-active" : ""}${at === null ? " is-detached" : ""}`} data-thread={root.path}>
      <button type="button" className="thread-anchor" onClick={onSelect} title={at === null ? "This passage is no longer in the text" : "Show in the editor"}>
        {suggestion ? <span className="thread-suggestion">{describeSuggestion(root)}</span> : root.target ? <blockquote className="thread-quote">{root.target.quote.exact || "(a point in the text)"}</blockquote> : <span className="small muted">On the whole record</span>}
        {at === null && <span className="thread-detached small">Detached: the text has changed</span>}
      </button>
      <Comment comment={root} people={people} />
      {thread.replies.map((r) => (
        <Comment key={r.path} comment={r} people={people} reply>
          {!r.deletedAt && mine(r) && (
            <button type="button" className="link small" disabled={busy} onClick={() => void run(() => onChange(r, { kind: "withdraw" }))}>
              Withdraw
            </button>
          )}
        </Comment>
      ))}
      {resolvedNote && <p className="thread-resolved small muted">{resolvedNote}</p>}
      {error && <p className="small tone-danger" role="alert">{error}</p>}
      {replying ? (
        <form
          className="thread-reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim()) void run(() => onReply(reply)).then((ok) => ok && (setReply(""), setReplying(false)));
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") setReplying(false);
            else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              e.currentTarget.requestSubmit();
            }
          }}
        >
          <textarea className="mdbase-field" rows={2} autoFocus value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply" aria-label="Reply" />
          <div className="thread-actions">
            <button type="submit" className="mdbase-button is-primary" disabled={busy || !reply.trim()} title={`${MOD_LABEL}-Enter`}>Reply</button>
            <button type="button" className="mdbase-button" onClick={() => setReplying(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="thread-actions">
          {open && suggestion && (
            <>
              <button type="button" className="mdbase-button is-primary" disabled={busy || at === null} onClick={() => void run(onAccept)} title={at === null ? "The suggested text is no longer there" : "Make this edit"}>
                Accept
              </button>
              <button type="button" className="mdbase-button" disabled={busy} onClick={() => void run(() => onChange(root, { kind: "resolve", outcome: "rejected" }))}>
                Reject
              </button>
            </>
          )}
          <button type="button" className="link small" onClick={() => setReplying(true)}>
            Reply
          </button>
          {open && !suggestion && (
            <button type="button" className="link small" disabled={busy} onClick={() => void run(() => onChange(root, { kind: "resolve" }))}>
              Resolve
            </button>
          )}
          {!open && (
            <button type="button" className="link small" disabled={busy} onClick={() => void run(() => onChange(root, { kind: "reopen" }))}>
              Reopen
            </button>
          )}
          {!root.deletedAt && mine(root) && !thread.replies.length && (
            <button type="button" className="link small" disabled={busy} onClick={() => void run(() => onChange(root, { kind: "withdraw" }))}>
              Withdraw
            </button>
          )}
        </div>
      )}
    </li>
  );
}

function Comment({ comment, people, reply, children }: { comment: CommentRecord; people: People; reply?: boolean; children?: ReactNode }) {
  const author = personName(comment.createdBy, people) ?? "Unsigned";
  return (
    <div className={`comment${reply ? " is-reply" : ""}`}>
      <p className="comment-meta small">
        <strong>{author}</strong> <time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>{when(comment.createdAt)}</time>
        {children}
      </p>
      {comment.deletedAt ? <p className="small muted">Withdrawn.</p> : comment.text ? <p className="comment-text">{comment.text}</p> : null}
    </div>
  );
}

/** "3 open comments", for the tab's title. */
export const openCount = (placed: readonly PlacedThread[]) => plural(placed.filter((p) => p.thread.root.status === "open").length, "open comment");
