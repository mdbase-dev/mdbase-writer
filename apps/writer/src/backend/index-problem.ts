import { t } from "@lingui/core/macro";
import { isMdbaseError } from "@mdbase-dev/sdk";
import type { ReadProblem, SessionProblem } from "./types.js";

/** An internal discovery check with fixed diagnostic text. */
export class IndexDiagnostic extends Error {}
/** The pages no longer describe one snapshot. Discovery starts again at page one. */
export class SnapshotChanged extends IndexDiagnostic {}

export function staleContinuation(error: unknown): boolean {
  return isMdbaseError(error, "invalid_request") && (error.reason === "cursor_stale" || error.reason === "cursor_expired");
}

const identifier = /^[a-z][a-z0-9_]{0,79}$/;
export function problemDetails({ code, reason }: SessionProblem): string {
  if (!identifier.test(code)) return "";
  return reason && identifier.test(reason) ? `${code}: ${reason}` : code;
}

function connectionProblem({ code, reason }: SessionProblem): string | undefined {
  if (reason === "device_offline" || reason === "device_not_serving") return t`Open mdbase on the computer that holds this collection, then try again.`;
  if (reason === "offline") return t`Check your internet connection, then try again.`;
  if (code === "unavailable") return t`Writer could not reach the collection. Check your connection and try again.`;
  if (code === "rate_limited") return t`The collection is getting too many requests. Wait a moment, then try again.`;
  if (code === "unauthenticated" || reason === "access_removed" || reason === "installation_scope_removed") return t`Writer no longer has access to this collection.`;
  if (code === "upgrade_required") return t`Update mdbase Connect, then try again.`;
  return undefined;
}

/** Record sessions supply a plain problem object, including optional server text. */
export function recordProblem(problem: SessionProblem): string {
  if (problem.reason === "record_session_budget") return t`There is more text than Writer can keep open at once. Try a smaller manuscript.`;
  if (problem.code === "conflict") return t`This document changed elsewhere. Reload and try again.`;
  return connectionProblem(problem) ?? t`Writer could not complete this operation. Try again.`;
}

/** Only typed codes select copy. SDK messages can contain server or collection data. */
export function indexProblem(error: unknown): ReadProblem {
  if (error instanceof SnapshotChanged) return { message: t`The library changed while loading. Try again.`, details: error.message };
  if (error instanceof IndexDiagnostic) return { message: t`Writer could not load the library. Try again.`, details: error.message };
  if (!isMdbaseError(error)) return { message: t`Writer could not load the library. Try again.` };

  const { code, reason } = error;
  const details = problemDetails(error);
  if (code === "unauthenticated" || reason === "access_removed" || reason === "installation_scope_removed") {
    return { message: t`Writer no longer has access to this collection.`, recovery: "reauthorize", details };
  }

  let message: string;
  if (staleContinuation(error)) message = t`The library changed while loading. Try again.`;
  else if (code === "too_large") message = t`This library is too large to index at once. Try opening a smaller collection.`;
  else if (code === "forbidden") message = t`Writer does not have permission to read this part of the collection. Check your collection access.`;
  else if (code === "collection_invalid") message = t`This collection needs attention. Open it in mdbase, then try again.`;
  else message = connectionProblem(error) ?? t`Writer could not load the library. Try again.`;
  return { message, details };
}
