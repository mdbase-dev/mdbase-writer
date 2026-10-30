import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useEffect, useState } from "react";
import { ConnectLayout, OpeningScreen } from "@mdbase-dev/ui/screens";
import type { WriterBackend } from "../backend/types.js";
import { Manuscripts } from "./Manuscripts.js";

const params = new URL(location.href).searchParams;
export function DemoRoot() {
  useLingui();
  const [backend, setBackend] = useState<WriterBackend | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let owned: WriterBackend | undefined;
    void import("../backend/demo.js").then(async ({ createDemoBackend }) => {
      // StrictMode may have disposed this effect while the module was loading.
      if (!live) return;
      const b = import.meta.env.DEV && params.get("demo") === "large"
        ? await (await import("../backend/large-demo.js")).createLargeDemoBackend()
        : await createDemoBackend();
      if (live) { owned = b; setBackend(b); }
      else b.dispose();
    }).catch((error: unknown) => { if (live) setProblem(error instanceof Error ? error.message : String(error)); });
    return () => {
      live = false;
      owned?.dispose();
    };
  }, []);
  if (problem) return <ConnectLayout app="writer" title={t`The demo could not be loaded`} error={problem}><button type="button" className="mdbase-button" onClick={() => location.reload()}><Trans>Retry loading</Trans></button></ConnectLayout>;
  if (!backend) return <OpeningScreen app="writer" title={t`Opening the demo collection`} />;
  return <Manuscripts backend={backend} />;
}

