// The app mark's reactions to writes the person asked for that do not go
// through a save notice: comments, chapters, exports and explicit saves.
// Autosave reaches the mark through the top bar's SaveNotice.
import { signalMdbaseMark } from "@mdbase-dev/ui/mark-activity";

/** Plays `saved` or `error` for a finished write, and hands the result on. */
export function signalResult<T extends { readonly ok: boolean }>(result: T): T {
  signalMdbaseMark(result.ok ? "saved" : "error");
  return result;
}

/**
 * For a write that also edits a record's text (adding a chapter, accepting a
 * suggestion): that record's autosave plays `saved` a moment later, so only a
 * failure is played here, rather than the mark reacting twice.
 */
export function signalFailure<T extends { readonly ok: boolean }>(result: T): T {
  if (!result.ok) signalMdbaseMark("error");
  return result;
}
