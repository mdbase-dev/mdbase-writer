import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useEffect, useState, type ReactNode } from "react";
import type { Mdbase, MdbaseApplicationConnection, MdbaseClient } from "@mdbase-dev/sdk";
import { ConnectLayout } from "@mdbase-dev/ui/screens";
import { NextWriterRecords } from "../backend/next-records.js";
import { ConnectionNoticeContext, useConnectionNotice } from "./connection-notice.js";
import { NativeWriterView } from "./NativeWriterView.js";
import { WriterCollectionGate, WriterCollectionSwitcher } from "./writer-collections.js";

export type WriterSdk = Mdbase;
export interface WriterNativeScope {
  readonly mdbase: Mdbase;
  readonly connection: MdbaseApplicationConnection;
  readonly records: NextWriterRecords;
  readonly signal: AbortSignal;
}
export interface SdkWriterRootProps {
  sdk: WriterSdk;
  /** Real native domain UI only. Never supply a fake legacy backend/client. */
  renderNative?(scope: WriterNativeScope): ReactNode;
}

/** Writer over the SDK's mdbase entry. The shared collection gate starts it and
 * owns sign-in, choosing, approval, setup and problems; Writer opens only the connection the
 * gate hands over in phase `ready`, and never closes the entry. */
export function SdkWriterRoot({ sdk, renderNative }: SdkWriterRootProps) {
  useLingui();
  const notice = useConnectionNotice(sdk);
  return <ConnectionNoticeContext.Provider value={notice}>
    <WriterCollectionGate mdbase={sdk}>
      {connection => <>
        <WriterCollectionSwitcher mdbase={sdk} />
        <NativeScopeView key={`${connection.id}:${connection.generation}`} mdbase={sdk} connection={connection} renderNative={renderNative} />
      </>}
    </WriterCollectionGate>
  </ConnectionNoticeContext.Provider>;
}

function NativeScopeView({ mdbase, connection, renderNative }: { mdbase: Mdbase; connection: MdbaseApplicationConnection; renderNative?: SdkWriterRootProps["renderNative"] }) {
  useLingui();
  const [view, setView] = useState<{ client: MdbaseClient; scope: WriterNativeScope } | null>(null);
  // The parent keys by SDK collection ID and generation. A later snapshot may hand
  // back a new facade for the same scope; it must not retire these leases.
  const [original] = useState(connection);
  const client = original.records;
  useEffect(() => {
    const lifetime = new AbortController();
    const records = new NextWriterRecords(client, lifetime.signal, () => original.isCurrent());
    let active = true;
    queueMicrotask(() => { if (active) setView({ client, scope: { mdbase, connection: original, records, signal: lifetime.signal } }); });
    return () => { active = false; lifetime.abort(); records.dispose(); };
  }, [mdbase, client, original]);
  if (!view || view.client !== client) return <ConnectLayout app="writer" title={t`Opening your collection`}><p role="status"><Trans>Opening Writer…</Trans></p></ConnectLayout>;
  return renderNative ? renderNative(view.scope) : <NativeWriterView scope={view.scope} />;
}
