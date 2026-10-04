// The sync status line for an mdbase-next collection.
import type { NextSync } from "../backend/next.js";

/** One line about the link and sync state, shown only when there is something to say. */
export function nextStatusText(sync: NextSync): string | null {
  if (sync.link !== "open") {
    if (sync.problem?.waitingForDevice) return "Waiting for one of your devices. Your edits are kept here and saved when one comes online.";
    if (sync.link === "closed") return sync.problem?.message ?? "Disconnected from the collection.";
    return "Reconnecting to the collection. Your edits are kept here.";
  }
  const parts: string[] = [];
  if (sync.status.connection !== "online" && sync.status.pending) parts.push(`${sync.status.pending} ${sync.status.pending === 1 ? "change is" : "changes are"} saved on the replica and waiting to sync`);
  if (sync.writeProblem) parts.push(`Not saved: ${sync.writeProblem}`);
  if (sync.holds) parts.push(`${sync.holds} ${sync.holds === 1 ? "record needs" : "records need"} a decision`);
  return parts.length ? `${parts.join("; ")}.` : null;
}
