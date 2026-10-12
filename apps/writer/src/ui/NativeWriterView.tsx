import { useEffect, useState } from "react";
import { ConnectLayout } from "@mdbase-dev/ui/screens";
import { NativeWriterBackend } from "../backend/native.js";
import { Manuscripts } from "./Manuscripts.js";
import type { WriterNativeScope } from "./SdkWriterRoot.js";

/** Existing Writer UI behind the domain interface, not a legacy client facade. */
export function NativeWriterView({scope}: {scope: WriterNativeScope}) {
  const [view, setView] = useState<{scope: WriterNativeScope; backend: NativeWriterBackend} | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let backend: NativeWriterBackend | undefined;
    try {
      backend = new NativeWriterBackend(scope.connection, {
        collectionName: scope.connection.displayName, signal: scope.signal, records: scope.records,
        authorize: () => scope.mdbase.application.reauthorize({signal: scope.signal}),
      });
      const owned = backend;
      queueMicrotask(() => {if (active) setView({scope, backend: owned});});
    } catch {queueMicrotask(() => {if (active) setFailed(true);});}
    return () => {active = false; backend?.dispose();};
  }, [scope]);
  if (failed) return <ConnectLayout app="writer" title="Writer could not open this collection"><p role="alert">This collection view could not be opened. Choose another collection from the bar above, or reload to retry.</p></ConnectLayout>;
  if (!view || view.scope !== scope) return <ConnectLayout app="writer" title="Opening Writer"><p role="status">Opening Writer…</p></ConnectLayout>;
  return <Manuscripts backend={view.backend} />;
}
