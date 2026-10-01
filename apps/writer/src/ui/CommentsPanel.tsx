// Comments on the manuscript's records: threads in reading order, with
// replies, resolving, and suggested edits to accept or reject. A new comment
// starts from a passage chosen in the editor (the draft).
import type { CommentRecord, CommentThread } from "@mdbase-writer/core/comments";
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { personName, type CommentChange, type People } from "../backend/comments.js";
import type { Result } from "../backend/types.js";
import { ALT_LABEL, MOD_LABEL } from "../editor/insight.js";
import type { CommentDraft } from "../workspace/workspace.js";
import { clipPassage, describeSuggestion, plainPassage, when, type PlacedThread } from "./comments.js";
import { useRowWindow } from "./paging.js";
import { PlusIcon } from "./icons.js";
import { plural } from "./records.js";

/** A passage chosen to comment on or suggest an edit to, or (without a draft) a whole record. */
export interface PendingComment {
  readonly kind: "comment" | "suggest";
  readonly record: string;
  readonly draft?: CommentDraft;
}

export type CommentDrafts = Map<string, { reply: string; replying: boolean }>;
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
  onCheckAccount,
  onReviewAccess,
  grouped = true,
  loading = false,
  onRetry,
  notSetUp = false,
  drafts: providedDrafts,
}: {
  drafts?: CommentDrafts;
  notSetUp?: boolean;
  loading?: boolean;
  onRetry?(): void;
  placed: readonly PlacedThread[];
  /** Threads are headed by their record's title (not for a manuscript of one record, whose title the top bar shows). */
  grouped?: boolean;
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
  /** Checks the account against the person records again. */
  onCheckAccount(): Promise<unknown>;
  /** Reopens Connect's approval, where the identity permission can be allowed. */
  onReviewAccess?(): Promise<Result<unknown>>;
}) {
  const [filter, setFilter] = useState<Filter>("open");
  const panel = useRef<HTMLElement>(null);
  const ownDrafts = useRef<CommentDrafts>(new Map());
  const drafts = providedDrafts ?? ownDrafts.current;
  const window = useRowWindow();
  const groups = useMemo(() => ({ open: placed.filter((p) => p.thread.root.status === "open"), resolved: placed.filter((p) => p.thread.root.status === "resolved") }), [placed]);
  const counts = { open: groups.open.length, resolved: groups.resolved.length };
  const logical = groups[filter];
  const shown = logical.slice(window.from, window.from + window.size);
  const onListKey = (e: KeyboardEvent<HTMLElement>) => {
    if (!(e.target as HTMLElement).matches(".thread-anchor")) return;
    const path = (e.target as HTMLElement).closest<HTMLElement>("[data-thread]")?.dataset["thread"];
    const rank = logical.findIndex((p) => p.thread.root.path === path);
    const direction = e.key === "ArrowDown" || e.key === "j" ? 1 : e.key === "ArrowUp" || e.key === "k" ? -1 : 0;
    const next = logical[rank + direction];
    if (!direction || !next) return;
    e.preventDefault(); window.reveal(rank + direction);
    requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>(`[data-thread="${CSS.escape(next.thread.root.path)}"] .thread-anchor`)?.focus());
  };

  // A thread selected in the editor comes into view (and shows, even when resolved).
  useEffect(() => {
    if (!active) return;
    const hit = placed.find((p) => p.thread.root.path === active);
    if (hit) { setFilter(hit.thread.root.status); window.reveal(groups[hit.thread.root.status].indexOf(hit)); }
    requestAnimationFrame(() => panel.current?.querySelector(`[data-thread="${CSS.escape(active)}"]`)?.scrollIntoView({ block: "nearest" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a new selection moves the list
  }, [active]);

  const signer = people.signing?.kind === "linked" ? people.me?.name : undefined;
  let lastRecord: string | null = null;
  return (
    <section ref={panel} className="comments" aria-label="Comments" onKeyDown={onListKey}>
      <div className="comments-bar">
        <div className="segmented small" role="group" aria-label="Show">
          {(["open", "resolved"] as const).map((f) => (
            <button key={f} type="button" aria-pressed={filter === f} onClick={() => { setFilter(f); window.reset(); }}>
              {f === "open" ? "Open" : "Resolved"} <span className="heading-count">{counts[f]}</span>
            </button>
          ))}
        </div>
        <button type="button" className="text-button" onClick={onWholeRecord} title="Comment on the whole record in the editor">
          <PlusIcon /> Comment
        </button>
      </div>
      <Signing people={people} onCheck={onCheckAccount} {...(onReviewAccess ? { onReviewAccess } : {})} />
      {pending && <Composer key={`${pending.record}:${pending.draft?.from ?? "whole"}:${pending.kind}`} pending={pending} signer={signer} recordTitle={recordTitle} onSubmit={onSubmit} onCancel={onCancel} />}
      {loading && <p className="muted small" role="status">Loading comments…</p>}
      {problem && <p className="muted small">Comments unavailable: {problem} {onRetry && <button type="button" className="text-button" onClick={onRetry}>Retry comments</button>}</p>}
      {notSetUp && <p className="muted small">Comments are not set up in this collection.</p>}
      {!loading && !problem && !notSetUp && !shown.length && !pending && (
        <div className="sidebar-empty">
          {filter === "open" ? (
            <>
              <p><strong>No open comments</strong></p>
              <p className="small muted">
                Select a passage and press <kbd>{MOD_LABEL}-{ALT_LABEL}-M</kbd> to comment, or <kbd>{MOD_LABEL}-{ALT_LABEL}-S</kbd> to suggest an edit.
              </p>
            </>
          ) : (
            <p className="small muted">Nothing resolved yet.</p>
          )}
        </div>
      )}
      <ul className="threads">
        {shown.map((p) => {
          const heading =
            grouped && p.record !== lastRecord ? (
              <li className="threads-record" key={`h:${p.record}`}>
                <h3 className="sidebar-heading" title={recordTitle(p.record)}>{recordTitle(p.record)}</h3>
              </li>
            ) : null;
          lastRecord = p.record;
          return [
            heading,
            <Thread
              key={p.thread.root.path}
              placed={p}
              drafts={drafts}
              people={people}
              active={p.thread.root.path === active}
              onSelect={onSelect}
              onReply={onReply}
              onChange={onChange}
              onAccept={onAccept}
            />,
          ];
        })}
      </ul>
      {window.from > 0 && <button type="button" className="sidebar-more" onClick={window.previous}>Show previous 50 comments</button>}
      {logical.length > window.from + window.size && <button type="button" className="sidebar-more" onClick={window.more}>Show 50 more comments · {logical.length}</button>}
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

function Composer({ pending, signer, recordTitle, onSubmit, onCancel }: { pending: PendingComment; signer: string | undefined; recordTitle(path: string): string; onSubmit(text: string, replacement?: string): Promise<Result<unknown>>; onCancel(): void }) {
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
      <p className="composer-title">
        <strong>{suggest ? "Suggest an edit" : "New comment"}</strong>
        <span className="small muted" title={recordTitle(pending.record)}>
          {signer ? <>as {signer} · </> : null}
          {recordTitle(pending.record)}
        </span>
      </p>
      {quote ? <blockquote className="thread-quote">{plainPassage(quote)}</blockquote> : <p className="thread-quote muted small">{draft ? (suggest ? "Insert at the cursor" : "At the cursor") : "On the whole record"}</p>}
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
        <button type="submit" className="mdbase-button is-primary is-small" disabled={busy || empty} title={`${MOD_LABEL}-Enter`}>
          {suggest ? "Suggest" : "Comment"}
        </button>
        <button type="button" className="mdbase-button is-small" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
  );
}

const Thread = memo(function Thread({
  drafts,
  placed,
  people,
  active,
  onSelect,
  onReply,
  onChange,
  onAccept,
}: {
  placed: PlacedThread;
  drafts: CommentDrafts;
  people: People;
  active: boolean;
  onSelect(placed: PlacedThread): void;
  onReply(thread: CommentThread, text: string): Promise<Result<unknown>>;
  onChange(comment: CommentRecord, change: CommentChange): Promise<Result<unknown>>;
  onAccept(placed: PlacedThread): Promise<Result<unknown>>;
}) {
  const repliesWindow = useRowWindow();
  const { thread, at } = placed;
  const { root } = thread;
  const [reply, setReply] = useState(() => drafts.get(root.path)?.reply ?? "");
  const [replying, setReplying] = useState(() => drafts.get(root.path)?.replying ?? false);
  useEffect(() => { drafts.set(root.path, { reply, replying }); }, [drafts, root.path, reply, replying]);
  const { busy, error, run } = useAction();
  const suggestion = root.motivation === "editing" && root.suggestion ? root.suggestion : null;
  const open = root.status === "open";
  const mine = (c: CommentRecord) => !c.createdBy || (people.me !== undefined && c.createdBy.toLowerCase() === people.me.link.toLowerCase());

  const outcome = suggestion?.outcome === "accepted" ? "Accepted" : suggestion?.outcome === "rejected" ? "Rejected" : "Resolved";
  const resolvedNote = !open ? `${suggestion ? outcome : "Resolved"}${root.resolvedBy ? ` by ${personName(root.resolvedBy, people)}` : ""}${root.resolvedAt ? ` ${when(root.resolvedAt)}` : ""}` : null;

  return (
    <li className={`thread${active ? " is-active" : ""}${at === null ? " is-detached" : ""}${open ? "" : " is-resolved"}`} data-thread={root.path}>
      <button type="button" className="thread-anchor" onClick={() => onSelect(placed)} title={at === null ? "This passage is no longer in the text" : "Show in the editor"}>
        {suggestion ? <Suggestion root={root} /> : root.target ? <blockquote className="thread-quote">{plainPassage(root.target.quote.exact) || "(a point in the text)"}</blockquote> : <span className="thread-whole small muted">On the whole record</span>}
        {at === null && <span className="thread-detached small">Detached: the text has changed</span>}
      </button>
      <Comment comment={root} people={people} />
      {thread.replies.slice(0, repliesWindow.size).map((r) => (
        <Comment key={r.path} comment={r} people={people} reply>
          {!r.deletedAt && mine(r) && (
            <button type="button" className="text-button is-quiet" disabled={busy} onClick={() => void run(() => onChange(r, { kind: "withdraw" }))}>
              Withdraw
            </button>
          )}
        </Comment>
      ))}
      {thread.replies.length > repliesWindow.size && <button type="button" className="sidebar-more" onClick={repliesWindow.more}>Show 50 more replies · {thread.replies.length}</button>}
      {resolvedNote && <p className="thread-resolved small muted">{resolvedNote}</p>}
      {error && <p className="small tone-danger" role="alert">{error}</p>}
      {replying ? (
        <form
          className="thread-reply"
          onSubmit={(e) => {
            e.preventDefault();
            if (reply.trim()) void run(() => onReply(thread, reply)).then((ok) => ok && (setReply(""), setReplying(false)));
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
            <button type="submit" className="mdbase-button is-primary is-small" disabled={busy || !reply.trim()} title={`${MOD_LABEL}-Enter`}>Reply</button>
            <button type="button" className="mdbase-button is-small" onClick={() => setReplying(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <div className="thread-actions">
          {open && suggestion && (
            <>
              <button type="button" className="mdbase-button is-primary is-small" disabled={busy || at === null} onClick={() => void run(() => onAccept(placed))} title={at === null ? "The suggested text is no longer there" : "Make this edit"}>
                Accept
              </button>
              <button type="button" className="mdbase-button is-small" disabled={busy} onClick={() => void run(() => onChange(root, { kind: "resolve", outcome: "rejected" }))}>
                Reject
              </button>
            </>
          )}
          <button type="button" className="text-button" onClick={() => setReplying(true)}>
            Reply
          </button>
          {open && !suggestion && (
            <button type="button" className="text-button" disabled={busy} onClick={() => void run(() => onChange(root, { kind: "resolve" }))}>
              Resolve
            </button>
          )}
          {!open && (
            <button type="button" className="text-button" disabled={busy} onClick={() => void run(() => onChange(root, { kind: "reopen" }))}>
              Reopen
            </button>
          )}
          {!root.deletedAt && mine(root) && !thread.replies.length && (
            <button type="button" className="text-button is-quiet" disabled={busy} onClick={() => void run(() => onChange(root, { kind: "withdraw" }))}>
              Withdraw
            </button>
          )}
        </div>
      )}
    </li>
  );
});

/** A suggested edit as it will read: the text taken out, struck through, and the text put in. */
function Suggestion({ root }: { root: CommentRecord }) {
  const exact = root.target?.quote.exact ?? "";
  const replacement = root.suggestion?.replacement ?? "";
  return (
    <span className="thread-suggestion" aria-label={describeSuggestion(root)}>
      <span aria-hidden="true">
        <span className="thread-suggestion-kind">{exact && replacement ? "Replace" : exact ? "Delete" : "Insert"}</span>{" "}
        {exact && <del>{clipPassage(exact)}</del>}
        {exact && replacement && <span className="thread-suggestion-kind"> with </span>}
        {replacement && <ins>{clipPassage(replacement)}</ins>}
      </span>
    </span>
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

/**
 * Why new comments are not signed, and where to fix it (a linked account is
 * named in the composer instead).
 * Linking an account to a person record happens in mdbase Editor, whose
 * settings page Connect names for this collection.
 */
function Signing({ people, onCheck, onReviewAccess }: { people: People; onCheck(): Promise<unknown>; onReviewAccess?(): Promise<Result<unknown>> }) {
  const { busy, error, run } = useAction();
  const { signing, settingsUrl } = people;
  if (!signing || signing.kind === "linked") return null;
  const link = (label: string) =>
    settingsUrl ? (
      <a className="text-button" href={settingsUrl} target="_blank" rel="noopener">
        {label}
      </a>
    ) : (
      <span className="small muted">Link it in mdbase Editor’s settings for this collection.</span>
    );
  const check = (
    <button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => (await onCheck(), { ok: true, value: null }))}>
      Check again
    </button>
  );
  let why: ReactNode;
  let actions: ReactNode;
  switch (signing.kind) {
    case "unlinked":
      why = "Your account is not linked to a person record in this collection.";
      actions = <>{link("Link your account")}{check}</>;
      break;
    case "conflict":
      why = signing.paths.length > 1 ? `${plural(signing.paths.length, "person record")} claim your account, so Writer will not guess which is you.` : "The person record that claims your account is not valid.";
      actions = <>{link("Fix it in mdbase Editor")}{check}</>;
      break;
    case "not-approved":
      why = "Writer was not allowed to see your account.";
      actions = onReviewAccess ? (
        <button type="button" className="mdbase-button" disabled={busy} onClick={() => void run(onReviewAccess)}>
          {busy ? "Waiting for approval…" : "Review access"}
        </button>
      ) : null;
      break;
    case "unavailable":
      why = `Your account could not be checked (${signing.reason}).`;
      actions = check;
      break;
  }
  return (
    <div className="signing is-unsigned" role="status">
      <p className="small"><strong>Your comments are not signed.</strong> {why}</p>
      {actions && <div className="thread-actions">{actions}</div>}
      {error && <p className="small tone-danger" role="alert">{error}</p>}
    </div>
  );
}
