import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { Component, useEffect, useState, type ReactNode } from "react";
import { FeedbackButton, useFeedback } from "@mdbase-dev/ui/feedback";
import { ConnectLayout, OpeningScreen } from "@mdbase-dev/ui/screens";
import type { WriterBackend } from "../backend/types.js";
import type { ManuscriptWorkspace } from "../workspace/workspace.js";
import { WriterShell } from "../App.js";
import { downloadLocalDrafts } from "./download-local-drafts.js";
import { Manuscripts } from "./Manuscripts.js";

export default function DemoRoot() {
  const { reportError } = useFeedback();
  return <WriterShell><ErrorBoundary onError={() => reportError({ code: "unknown_error" })}><DemoCollection /></ErrorBoundary></WriterShell>;
}

class ErrorBoundary extends Component<{ children: ReactNode; onError(): void }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override componentDidCatch() { this.props.onError(); }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="gate">
        <h1><Trans>Something went wrong</Trans></h1>
        <FeedbackButton topic="problem" />
        <p>{this.state.error.message}</p>
        <p className="muted"><Trans>Your saved text is in your collection. Unsent local drafts are backed up in this browser when storage is available. Download a copy before reloading.</Trans></p>
        <button className="mdbase-button" type="button" onClick={() => {
          const workspace = (window as unknown as { writer?: { workspace?: ManuscriptWorkspace } }).writer?.workspace;
          if (workspace) downloadLocalDrafts(workspace);
        }}><Trans>Download local drafts</Trans></button>
        <button className="mdbase-button" type="button" onClick={() => location.reload()}><Trans>Reload</Trans></button>
      </main>
    );
  }
}

function DemoCollection() {
  useLingui();
  const [backend, setBackend] = useState<WriterBackend | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let owned: WriterBackend | undefined;
    void import("../backend/demo.js").then(async ({ createDemoBackend }) => {
      // StrictMode may have disposed this effect while the module was loading.
      if (!live) return;
      const b = import.meta.env.DEV && new URL(location.href).searchParams.get("demo") === "large"
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
