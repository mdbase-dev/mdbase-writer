import { t, plural as icuPlural } from "@lingui/core/macro";
import { formatNumber } from "../i18n/presentation.js";
// How the workspace names a record and its save state.
import type { SaveTone } from "@mdbase-dev/ui/save-notice";

import type { RecordView, SessionSnapshot } from "../workspace/workspace.js";

export const STATE_LABEL: Record<SessionSnapshot["state"], string> = {
  get saved() { return t`Saved`; },
  get saved_on_device() { return t`Saved on this device; waiting for sync`; },
  get unsaved() { return t`Unsaved`; },
  get saving() { return t`Saving…`; },
  get conflict() { return t`Changed elsewhere`; },
  get recovery() { return t`Recovering save…`; },
  get error() { return t`Not saved`; },
  get deleted() { return t`Deleted elsewhere`; },
};
/** The states that need attention, in few words, for a phone's top bar (the editor's banner says more). */
export const STATE_SHORT_LABEL: Partial<Record<SessionSnapshot["state"], string>> = {
  get conflict() { return t`Conflict`; },
  get error() { return t`Not saved`; },
  get deleted() { return t`Deleted`; },
};
export const STATE_TONE: Record<SessionSnapshot["state"], SaveTone> = {
  saved: "saved", saved_on_device: "pending", unsaved: "pending", saving: "saving", conflict: "attention", recovery: "saving", error: "attention", deleted: "attention",
};

/** A recovered checkpoint is not an acknowledged save until it is reviewed. */
export function workspaceSaveNotice(state: SessionSnapshot["state"], hasRecoveredDrafts: boolean): { tone: SaveTone; label: string; shortLabel: string | undefined } {
  return hasRecoveredDrafts
    ? { tone: "attention", label: t`Review local drafts`, shortLabel: t`Review drafts` }
    : { tone: STATE_TONE[state], label: STATE_LABEL[state], shortLabel: STATE_SHORT_LABEL[state] };
}

export function recordTitle(view: RecordView | undefined, path: string): string {
  const fm = view?.snapshot.frontmatter;
  if (typeof fm?.["title"] === "string") return fm["title"];
  const heading = /^#\s+(.+?)(?:\s*\{[^}]*\})?\s*$/m.exec(view?.snapshot.body ?? "");
  return heading?.[1] ?? path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}

export const formatCount = formatNumber;
/** Stable noun keys, not translated strings, select complete ICU count messages. */
export function plural(n: number, one: string, _many?: string): string {
  switch (one) {
    case "word": return icuPlural(n, { one: "# word", other: "# words" });
    case "problem": return icuPlural(n, { one: "# problem", other: "# problems" });
    case "error": return icuPlural(n, { one: "# error", other: "# errors" });
    case "warning": return icuPlural(n, { one: "# warning", other: "# warnings" });
    case "record": return icuPlural(n, { one: "# record", other: "# records" });
    case "match": return icuPlural(n, { one: "# match", other: "# matches" });
    case "open comment": return icuPlural(n, { one: "# open comment", other: "# open comments" });
    case "person record": return icuPlural(n, { one: "# person record", other: "# person records" });
    case "recovered local draft": return icuPlural(n, { one: "# recovered local draft", other: "# recovered local drafts" });
    default: return formatNumber(n);
  }
}
