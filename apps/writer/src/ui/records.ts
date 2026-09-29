// How the workspace names a record and its save state.
import type { SaveTone } from "@mdbase-dev/ui/save-notice";

import type { RecordView, SessionSnapshot } from "../workspace/workspace.js";

export const STATE_LABEL: Record<SessionSnapshot["state"], string> = {
  saved: "Saved",
  unsaved: "Unsaved",
  saving: "Saving…",
  conflict: "Changed elsewhere",
  recovery: "Recovering save…",
  error: "Not saved",
  deleted: "Deleted elsewhere",
};
export const STATE_TONE: Record<SessionSnapshot["state"], SaveTone> = {
  saved: "saved", unsaved: "pending", saving: "saving", conflict: "attention", recovery: "saving", error: "attention", deleted: "attention",
};

export function recordTitle(view: RecordView | undefined, path: string): string {
  const fm = view?.snapshot.frontmatter;
  if (typeof fm?.["title"] === "string") return fm["title"];
  const heading = /^#\s+(.+?)(?:\s*\{[^}]*\})?\s*$/m.exec(view?.snapshot.body ?? "");
  return heading?.[1] ?? path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
