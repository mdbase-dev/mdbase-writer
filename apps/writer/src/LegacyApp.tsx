// Top level: pick the backend (Connect, or the development demo), then show
// the manuscript list or an open manuscript. The open manuscript lives in the
// URL (`?manuscript=path`) so reloads and links land in the same place.
import { externalStore } from "@mdbase-dev/connect";
import { Component, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { ConnectBackend } from "./backend/connect.js";
import type { WriterBackend } from "./backend/types.js";
import { createWriterSession, type WriterSession } from "./connect/session.js";
import { appUrls } from "./apps.js";
import { AppSwitcher } from "@mdbase-dev/ui/app-switcher";
import { FeedbackButton, useFeedback } from "@mdbase-dev/ui/feedback";
import { Manuscripts } from "./ui/Manuscripts.js";
import { downloadLocalDrafts } from "./ui/download-local-drafts.js";
import { ConnectGate } from "./ui/ConnectGate.js";
import { CollectionPicker } from "./ui/CollectionPicker.js";

import { loadThemePreference, saveThemePreference, type ThemePreference } from "@mdbase-dev/ui/theme";
import { ThemeChoice, TopbarSlot } from "./ui/topbar.js";
import { ThemeSelect } from "@mdbase-dev/ui/theme-select";
import { ConnectLayout, OpeningScreen } from "@mdbase-dev/ui/screens";

import { ManuscriptWorkspace } from "./workspace/workspace.js";


const params = new URL(location.href).searchParams;
const demoRequested = (import.meta.env.DEV || import.meta.env.VITE_WRITER_DEMO === "1") && params.has("demo");

export function LegacyApp() {
  const { reportError } = useFeedback();
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => saveThemePreference(theme), [theme]);
  const themeChoice = useMemo(() => ({ theme, setTheme }), [theme]);
  return (
    <ThemeChoice.Provider value={themeChoice}>
      <TopbarSlot.Provider value={slot}>
        <div className="app">
          <header className="topbar">
            <AppSwitcher current="writer" urls={appUrls} />
            <div className="topbar-slot" ref={setSlot} />
            <ThemeSelect className="topbar-theme" value={theme} onChange={setTheme} />
            <FeedbackButton />
          </header>
          <ErrorBoundary onError={() => reportError({ code: "unknown_error" })}>{demoRequested ? <DemoRoot /> : <ConnectRoot />}</ErrorBoundary>
        </div>
      </TopbarSlot.Provider>
    </ThemeChoice.Provider>
  );
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
        <h1>Something went wrong</h1>
        <FeedbackButton topic="problem" />
        <p>{this.state.error.message}</p>
        <p className="muted">Your saved text is in your collection. Unsent local drafts are backed up in this browser when storage is available. Download a copy before reloading.</p>
        <button className="mdbase-button" type="button" onClick={() => {
          const workspace = (window as unknown as { writer?: { workspace?: ManuscriptWorkspace } }).writer?.workspace;
          if (workspace) downloadLocalDrafts(workspace);
        }}>Download local drafts</button>
        <button className="mdbase-button" type="button" onClick={() => location.reload()}>Reload</button>
      </main>
    );
  }
}

// Instances with a lifetime (sessions, backends, workspaces) are created in
// the effect that disposes them, so development double-mounting cannot leave
// the UI holding a disposed one.
function useOwned<T>(create: () => T | null, dispose: (value: T) => void, deps: readonly unknown[]): T | null {
  const [value, setValue] = useState<{keys: readonly unknown[]; resource: T | null} | null>(null);
  useEffect(() => {
    const created = create(); const keys = [...deps]; let active = true;
    queueMicrotask(() => {if (active) setValue({keys, resource: created});});
    return () => {active = false; if (created) dispose(created);};
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the real dependencies
  }, deps);
  return value?.keys.length === deps.length && deps.every((dependency, index) => Object.is(dependency, value.keys[index])) ? value.resource : null;
}

function ConnectRoot() {
  const session = useOwned<WriterSession>(() => {
    const s = createWriterSession();
    void s.start({ timeoutMs: 30_000 });
    return s;
  }, (s) => s.destroy(), []);
  if (!session) return null;
  return <ConnectedRoot session={session} />;
}

function ConnectedRoot({ session }: { session: WriterSession }) {
  const store = useMemo(() => externalStore(session), [session]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const connection = snapshot.status === "ready" ? session.connection() : null;
  const owned = useOwned(
    () => (connection ? { connection, backend: new ConnectBackend(connection, () => session.authorize("selected", { presentation: "popup" })) } : null),
    (value) => value.backend.dispose(),
    [connection],
  );
  const backend = owned?.connection === connection ? owned?.backend : null;
  if (!backend || snapshot.status !== "ready") {
    return <ConnectGate session={session} snapshot={snapshot} />;
  }
  return <Manuscripts key={snapshot.collectionId} backend={backend} collectionPicker={
    <CollectionPicker name={backend.collectionName} collectionId={snapshot.collectionId} connections={snapshot.connections} session={session} />
  } />;
}

function DemoRoot() {
  const [backend, setBackend] = useState<WriterBackend | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    let owned: WriterBackend | undefined;
    void import("./backend/demo.js").then(async ({ createDemoBackend }) => {
      // StrictMode may have disposed this effect while the module was loading.
      if (!live) return;
      const b = import.meta.env.DEV && params.get("demo") === "large"
        ? await (await import("./backend/large-demo.js")).createLargeDemoBackend()
        : await createDemoBackend();
      if (live) { owned = b; setBackend(b); }
      else b.dispose();
    }).catch((error: unknown) => { if (live) setProblem(error instanceof Error ? error.message : String(error)); });
    return () => {
      live = false;
      owned?.dispose();
    };
  }, []);
  if (problem) return <ConnectLayout app="writer" title="The demo could not be loaded" error={problem}><button type="button" className="mdbase-button" onClick={() => location.reload()}>Retry loading</button></ConnectLayout>;
  if (!backend) return <OpeningScreen app="writer" title="Opening the demo collection" />;
  return <Manuscripts backend={backend} />;
}
