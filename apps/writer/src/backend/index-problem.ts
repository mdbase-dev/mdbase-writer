import { t } from "@lingui/core/macro";
import { isMdbaseError } from "@mdbase-dev/sdk";
import type { ReadProblem } from "./types.js";

/** The pages no longer describe one snapshot. Discovery starts again at page one. */
export class SnapshotChanged extends Error {}

export function staleContinuation(error: unknown): boolean {
  return isMdbaseError(error, "invalid_request") && (error.reason === "cursor_stale" || error.reason === "cursor_expired");
}

/** Only typed codes select copy. SDK messages can contain server or collection data. */
export function indexProblem(error: unknown): ReadProblem {
  if (error instanceof SnapshotChanged) return { message: t`The library changed while loading. Try again.`, details: error.message };
  if (!isMdbaseError(error)) return { message: t`Writer could not load the library. Try again.` };

  const { code, reason } = error;
  const details = reason && /^[a-z][a-z0-9_]{0,79}$/.test(reason) ? `${code}: ${reason}` : code;
  if (code === "unauthenticated" || reason === "access_removed" || reason === "installation_scope_removed") {
    return { message: t`Writer no longer has access to this collection.`, recovery: "reauthorize", details };
  }

  let message: string;
  if (staleContinuation(error)) message = t`The library changed while loading. Try again.`;
  else if (reason === "device_offline" || reason === "device_not_serving") message = t`Open mdbase on the computer that holds this collection, then try again.`;
  else if (reason === "offline") message = t`Check your internet connection, then try again.`;
  else if (code === "unavailable") message = t`Writer could not reach the collection. Check your connection and try again.`;
  else if (code === "too_large") message = t`This library is too large to index at once. Try opening a smaller collection.`;
  else if (code === "rate_limited") message = t`The collection is getting too many requests. Wait a moment, then try again.`;
  else if (code === "upgrade_required") message = t`Update mdbase Connect, then try again.`;
  else if (code === "forbidden") message = t`Writer does not have permission to read this part of the collection. Check your collection access.`;
  else if (code === "collection_invalid") message = t`This collection needs attention. Open it in mdbase, then try again.`;
  else message = t`Writer could not load the library. Try again.`;
  return { message, details };
}
