import { t, plural as icuPlural } from "@lingui/core/macro";
import { formatNumber } from "../i18n/presentation.js";
// How the workspace names a record and its save state.
import type { SaveTone } from "@mdbase-dev/ui/save-notice";

import type { RecordView, SessionSnapshot } from "../workspace/workspace.js";
import { connectionNoticeLabels, type ConnectionNotice } from "./connection-notice.js";

export const STATE_LABEL: Record<SessionSnapshot["state"], string> = {
  get saved() { return t`Saved`; },
  get saved_on_device() { return t`Saved on this device; waiting for sync`; },
  get unsaved() { return t`Saving…`; },
  get saving() { return t`Saving…`; },
  get conflict() { return t`Changed elsewhere`; },
  get recovery() { return t`Recovering save…`; },
  get error() { return t`Not saved`; },
  get deleted() { return t`Deleted elsewhere`; },
};
/** Unsettled save states, in few words, for a phone's top bar (the editor's banner says more). */
export const STATE_SHORT_LABEL: Partial<Record<SessionSnapshot["state"], string>> = {
  get saved_on_device() { return t`On device · pending sync`; },
  get unsaved() { return t`Saving…`; },
  get saving() { return t`Saving…`; },
  get recovery() { return t`Recovering save…`; },
  get conflict() { return t`Conflict`; },
  get error() { return t`Not saved`; },
  get deleted() { return t`Deleted`; },
};
export const STATE_TONE: Record<SessionSnapshot["state"], SaveTone> = {
  saved: "saved", saved_on_device: "pending", unsaved: "pending", saving: "saving", conflict: "attention", recovery: "saving", error: "attention", deleted: "attention",
};

/** A recovered checkpoint is not an acknowledged save until it is reviewed. */
export function workspaceSaveNotice(state: SessionSnapshot["state"], hasRecoveredDrafts: boolean, connection: ConnectionNotice | null = null, locallySaved = false): { tone: SaveTone; label: string; shortLabel: string | undefined } {
  if (hasRecoveredDrafts) return { tone: "attention", label: t`Review local drafts`, shortLabel: t`Review drafts` };
  if (STATE_TONE[state] === "attention") return { tone: "attention", label: STATE_LABEL[state], shortLabel: STATE_SHORT_LABEL[state] };
  if (connection === "sync_delayed") return { tone: "attention", label: connectionNoticeLabels.sync_delayed, shortLabel: t`Not on server` };
  if (state === "recovery") return { tone: STATE_TONE[state], label: STATE_LABEL[state], shortLabel: STATE_SHORT_LABEL[state] };
  if (locallySaved && (state === "unsaved" || state === "saving")) return { tone: "pending", label: t`Saved on this device`, shortLabel: t`Saved on this device` };
  if (locallySaved && (state === "saved_on_device" || connection === "saved_on_device")) return {
    tone: "pending",
    label: connection === "offline" ? t`Offline · saved on this device; waiting for sync` : STATE_LABEL.saved_on_device,
    shortLabel: connection === "offline" ? t`Offline · on device, pending sync` : STATE_SHORT_LABEL.saved_on_device,
  };
  if (connection && connection !== "saved_on_device") return { tone: "pending", label: connectionNoticeLabels[connection], shortLabel: connectionNoticeLabels[connection] };
  if (state === "saved_on_device" || connection === "saved_on_device") return { tone: "pending", label: STATE_LABEL.unsaved, shortLabel: STATE_SHORT_LABEL.unsaved };
  return { tone: STATE_TONE[state], label: STATE_LABEL[state], shortLabel: STATE_SHORT_LABEL[state] };
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
