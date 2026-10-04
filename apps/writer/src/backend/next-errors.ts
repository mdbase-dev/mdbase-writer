// The mdbase-next SDK's 15 error codes, as Writer shows them. Each code has
// one recovery action (replica-client-api.md §9); Writer adds its own text.
import { isMdbaseError, type ErrorCode } from "@mdbase-dev/sdk";

import type { SessionProblem } from "./types.js";

/** What the person can do about a problem. */
export type NextRecovery = "fix" | "refresh" | "resolve" | "reconnect" | "repair" | "wait" | "free-space" | "upgrade" | "check" | "none" | "report";

export interface NextProblem extends SessionProblem {
  readonly code: ErrorCode;
  readonly message: string;
  readonly reason?: string;
  readonly recovery: NextRecovery;
  /** A private collection with none of the person's devices online: a state, not an error. */
  readonly waitingForDevice?: boolean;
}

const TEXT: Record<ErrorCode, { readonly message: string; readonly recovery: NextRecovery }> = {
  invalid_request: { message: "Writer sent a request this collection could not accept.", recovery: "report" },
  invalid_record: { message: "The collection's type rules do not accept this change.", recovery: "fix" },
  not_found: { message: "This record no longer exists in the collection.", recovery: "refresh" },
  conflict: { message: "This changed elsewhere at the same time.", recovery: "resolve" },
  unauthenticated: { message: "Writer's access to this collection has ended. Connect again to continue.", recovery: "reconnect" },
  forbidden: { message: "Writer is not allowed to make this change in this collection.", recovery: "reconnect" },
  collection_invalid: { message: "The collection needs to be repaired before Writer can use it.", recovery: "repair" },
  unavailable: { message: "The collection cannot be reached right now. Writer keeps trying.", recovery: "wait" },
  rate_limited: { message: "The collection is busy. Writer will try again shortly.", recovery: "wait" },
  quota_exceeded: { message: "The collection is out of space.", recovery: "free-space" },
  too_large: { message: "This is too large for the collection to store.", recovery: "fix" },
  upgrade_required: { message: "This version of Writer is too old for the collection. Reload to update it.", recovery: "upgrade" },
  outcome_unknown: { message: "Writer could not confirm whether the last save went through. It will check again before saving more.", recovery: "check" },
  cancelled: { message: "Cancelled.", recovery: "none" },
  internal: { message: "Something went wrong in the collection.", recovery: "report" },
};

const REASONS: Readonly<Record<string, string>> = {
  no_device_online: "Waiting for one of your devices to come online.",
  path_taken: "A record already exists at that path.",
  reconnecting: "Reconnecting to the collection.",
};

/** Writer's text for an SDK code and optional reason. */
export function nextProblem(code: ErrorCode, reason?: string): NextProblem {
  const known = TEXT[code];
  const message = (reason && REASONS[reason]) || known.message;
  return {
    code, message, recovery: known.recovery,
    ...(reason ? { reason } : {}),
    ...(code === "unavailable" && reason === "no_device_online" ? { waitingForDevice: true } : {}),
  };
}

/** Any thrown value as a Writer problem: SDK errors by code, anything else as `internal`. */
export function problemFrom(error: unknown): NextProblem {
  if (isMdbaseError(error)) return nextProblem(error.code, error.reason);
  const problem = nextProblem("internal");
  return error instanceof Error && error.message ? { ...problem, message: `${problem.message} (${error.message})` } : problem;
}

/** A problem from a rejected receipt's problem, which carries a code that may be newer than this SDK. */
export function problemFromWire(problem: { readonly code: string; readonly reason?: string } | undefined, fallback: ErrorCode = "internal"): NextProblem {
  const code = problem && problem.code in TEXT ? problem.code as ErrorCode : fallback;
  return nextProblem(code, problem?.reason);
}

/** A create may be retried at another path. */
export const isPathTaken = (problem: { readonly code: string; readonly reason?: string } | undefined) =>
  problem?.code === "conflict" && (problem.reason === undefined || problem.reason === "path_taken");
