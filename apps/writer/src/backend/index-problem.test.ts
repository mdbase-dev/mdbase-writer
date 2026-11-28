import { MdbaseError } from "@mdbase-dev/sdk";
import { expect, it } from "vitest";
import { indexProblem, SnapshotChanged, staleContinuation } from "./index-problem.js";

it.each([
  ["invalid_request", "cursor_stale", /changed while loading/i],
  ["invalid_request", "cursor_expired", /changed while loading/i],
  ["too_large", "query_budget_exceeded", /smaller collection/i],
  ["unavailable", undefined, /could not reach the collection/i],
  ["unavailable", "offline", /check your internet connection/i],
  ["unavailable", "device_offline", /computer that holds this collection/i],
  ["unavailable", "device_not_serving", /computer that holds this collection/i],
  ["rate_limited", undefined, /wait a moment/i],
  ["upgrade_required", undefined, /update mdbase connect/i],
  ["forbidden", "capability_missing", /check your collection access/i],
  ["collection_invalid", undefined, /open it in mdbase/i],
  ["invalid_request", "future_reason", /could not load the library/i],
] as const)("explains %s (%s) in plain language", (code, reason, copy) => {
  const error = new MdbaseError({ code, recovery: "none", message: "untrusted_server_message", ...(reason ? { reason } : {}) });
  const problem = indexProblem(error);
  expect(problem.message).toMatch(copy);
  expect(problem.message).not.toMatch(/\w_\w|untrusted/i);
  expect(problem.details).toBe(reason ? `${code}: ${reason}` : code);
  expect(staleContinuation(error)).toBe(reason === "cursor_stale" || reason === "cursor_expired");
});

it.each([
  ["unauthenticated", undefined], ["forbidden", "access_removed"], ["forbidden", "installation_scope_removed"],
] as const)("preserves reauthorization for %s (%s)", (code, reason) => {
  const error = new MdbaseError({ code, recovery: "reauthorize", message: "private record path", ...(reason ? { reason } : {}) });
  expect(indexProblem(error)).toEqual({ message: "Writer no longer has access to this collection.", recovery: "reauthorize", details: reason ? `${code}: ${reason}` : code });
});

it("keeps snapshot diagnostics and drops arbitrary exception and server text", () => {
  expect(indexProblem(new SnapshotChanged("Snapshot digest changed."))).toEqual({ message: "The library changed while loading. Try again.", details: "Snapshot digest changed." });
  expect(indexProblem(new MdbaseError({ code: "internal", recovery: "none", message: "server payload", reason: "private/path.md" }))).toEqual({ message: "Writer could not load the library. Try again.", details: "internal" });
  expect(indexProblem(new Error("cursor_stale: private/path.md"))).toEqual({ message: "Writer could not load the library. Try again." });
});
