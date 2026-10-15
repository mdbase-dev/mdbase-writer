// How the workspace names a record and its save state.
import type { SaveTone } from "@mdbase-dev/ui/save-notice";

import type { RecordView, SessionSnapshot } from "../workspace/workspace.js";

export const STATE_LABEL: Record<SessionSnapshot["state"], string> = {
  saved: "Saved",
  saved_on_device: "Saved on this device; waiting for sync",
  unsaved: "Unsaved",
  saving: "Saving…",
  conflict: "Changed elsewhere",
  recovery: "Recovering save…",
  error: "Not saved",
  deleted: "Deleted elsewhere",
};
/** The states that need attention, in few words, for a phone's top bar (the editor's banner says more). */
export const STATE_SHORT_LABEL: Partial<Record<SessionSnapshot["state"], string>> = {
  conflict: "Conflict",
  error: "Not saved",
  deleted: "Deleted",
};
export const STATE_TONE: Record<SessionSnapshot["state"], SaveTone> = {
  saved: "saved", saved_on_device: "pending", unsaved: "pending", saving: "saving", conflict: "attention", recovery: "saving", error: "attention", deleted: "attention",
};

/** A recovered checkpoint is not an acknowledged save until it is reviewed. */
export function workspaceSaveNotice(state: SessionSnapshot["state"], hasRecoveredDrafts: boolean): { tone: SaveTone; label: string; shortLabel: string | undefined } {
  return hasRecoveredDrafts
    ? { tone: "attention", label: "Review local drafts", shortLabel: "Review drafts" }
    : { tone: STATE_TONE[state], label: STATE_LABEL[state], shortLabel: STATE_SHORT_LABEL[state] };
}

export function recordTitle(view: RecordView | undefined, path: string): string {
  const fm = view?.snapshot.frontmatter;
  if (typeof fm?.["title"] === "string") return fm["title"];
  const heading = /^#\s+(.+?)(?:\s*\{[^}]*\})?\s*$/m.exec(view?.snapshot.body ?? "");
  return heading?.[1] ?? path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}

// One formatter for every count: toLocaleString makes a new one each call.
const numbers = new Intl.NumberFormat();
export const formatCount = (n: number) => numbers.format(n);
export const plural = (n: number, one: string, many = `${one}s`) => `${formatCount(n)} ${n === 1 ? one : many}`;
