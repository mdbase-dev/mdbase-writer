import { zip } from "../export/zip.js";
import type { ManuscriptWorkspace } from "../workspace/workspace.js";

export function downloadLocalDrafts(workspace: ManuscriptWorkspace): void {
  const bytes = zip(workspace.localDrafts());
  const url = URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], {type: "application/zip"}));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = "writer-local-drafts.zip"; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
