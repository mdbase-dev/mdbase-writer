import { useContext, useRef, useState, type ReactNode } from "react";
import { useLingui } from "@lingui/react";
import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { MdbaseAppMark } from "@mdbase-dev/ui/brand";
import { CollectionGate, CollectionSwitcher, useCollectionUi, type CollectionAppIdentity } from "@mdbase-dev/ui/collections";
import type { Mdbase, MdbaseApplicationConnection } from "@mdbase-dev/sdk";
import manifest from "../generated/mdbase-app.json";
import { SaveNotice } from "@mdbase-dev/ui/save-notice";
import { ConnectionNoticeContext, connectionNoticeLabels } from "./connection-notice.js";
import { InTopbar } from "./topbar.js";
import "@mdbase-dev/ui/collections.css";
import "./writer-collections.css";

/** Writer's identity in the shared collection screens. */
const writerApp: CollectionAppIdentity = {name: manifest.name, mark: <MdbaseAppMark app="writer" />};

export function CollectionAccessActions({mdbase, collectionId}: {mdbase: Mdbase; collectionId: string}) {
  const {actions, busy, copy, error} = useCollectionUi({mdbase, app: writerApp});
  const [choosing, setChoosing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return <div className="connection-actions">
    <button type="button" className="mdbase-button" ref={trigger} aria-haspopup="dialog" aria-expanded={choosing} disabled={!!busy} onClick={() => setChoosing(true)}>{copy.chooseAnother}</button>
    <CollectionSwitcher mdbase={mdbase} app={writerApp} variant="none" open={choosing} onOpenChange={setChoosing} anchorRef={trigger} />
    <button type="button" className="mdbase-button" disabled={!!busy} onClick={() => actions.approve(collectionId)}><Trans>Ask for access again</Trans></button>
    {error && <p>{error.message}</p>}
  </div>;
}

/** The shared gate: sign-in, choosing, approval, setup and problems. */
export function WriterCollectionGate({mdbase, children}: {mdbase: Mdbase; children(connection: MdbaseApplicationConnection): ReactNode}) {
  useLingui();
  return <CollectionGate mdbase={mdbase} app={writerApp} copy={{ signedOutHeading: t`Write, cite, and typeset your manuscript` }}>{children}</CollectionGate>;
}

/** The shared switcher in the top bar. It is hidden while a manuscript is open,
 * where the bar belongs to the manuscript and leaving goes through its own save guard. */
export function WriterCollectionSwitcher({mdbase}: {mdbase: Mdbase}) {
  useLingui();
  const notice = useContext(ConnectionNoticeContext);
  return <InTopbar>
    <CollectionSwitcher mdbase={mdbase} app={writerApp} variant="full" className="writer-collection-switcher" />
    {notice && <SaveNotice tone="pending" label={connectionNoticeLabels[notice]} className="writer-connection-notice" />}
  </InTopbar>;
}
