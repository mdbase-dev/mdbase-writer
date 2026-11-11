import { plural as icuPlural, t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
// Why new comments are not signed, and where to fix it (a linked account is
// named in the composer instead). Linking an account to a person record
// happens in mdbase Editor, whose settings page Connect names for this collection.
import { useState, type ReactNode } from "react";

import type { People } from "../backend/comments.js";
import type { Result } from "../backend/types.js";

export function CommentSigning({ people, onCheck, onReviewAccess }: { people: People; onCheck(): Promise<unknown>; onReviewAccess?(): Promise<Result<unknown>> }) {
  useLingui();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<Result<unknown>>) => {
    setBusy(true);
    setError(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setError(result.message);
  };
  const { signing, settingsUrl } = people;
  if (!signing || signing.kind === "linked") return null;
  const link = (label: string) =>
    settingsUrl ? (
      <a className="text-button" href={settingsUrl} target="_blank" rel="noopener">
        {label}
      </a>
    ) : (
      <span><Trans>Link it in mdbase Editor’s settings for this collection.</Trans></span>
    );
  const check = (
    <button type="button" className="text-button" disabled={busy} onClick={() => void run(async () => (await onCheck(), { ok: true, value: null }))}><Trans>
      Check again
    </Trans></button>
  );
  let why: ReactNode;
  let actions: ReactNode;
  switch (signing.kind) {
    case "unlinked":
      why = t`Your account is not linked to a person record in this collection.`;
      actions = <>{link(t`Link your account`)}{check}</>;
      break;
    case "conflict":
      why = signing.paths.length > 1 ? icuPlural(signing.paths.length, { one: "# person record claims your account, so Writer will not guess which is you.", other: "# person records claim your account, so Writer will not guess which is you." }) : t`The person record that claims your account is not valid.`;
      actions = <>{link(t`Fix it in mdbase Editor`)}{check}</>;
      break;
    case "not-approved":
      why = t`Writer was not allowed to see your account.`;
      actions = onReviewAccess ? (
        <button type="button" className="mdbase-button" disabled={busy} onClick={() => void run(onReviewAccess)}>
          {busy ? t`Waiting for approval…` : t`Review access`}
        </button>
      ) : null;
      break;
    case "unavailable":
      why = t`Your account could not be checked (${signing.reason}).`;
      actions = check;
      break;
  }
  return (
    <div className="mdbase-comments-signing" role="status">
      <p><strong><Trans>Your comments are not signed.</Trans></strong> {why}</p>
      {actions && <div className="mdbase-thread-actions">{actions}</div>}
      {error && <p className="mdbase-comments-error" role="alert">{error}</p>}
    </div>
  );
}
