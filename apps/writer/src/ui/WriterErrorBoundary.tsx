import { Trans } from "@lingui/react/macro";
import { Component, type ReactNode } from "react";
import { FeedbackButton } from "@mdbase-dev/ui/feedback";
import type { ManuscriptWorkspace } from "../workspace/workspace.js";
import { downloadLocalDrafts } from "./download-local-drafts.js";

export class WriterErrorBoundary extends Component<{ children: ReactNode; onError(): void }, { error: Error | null }> {
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

