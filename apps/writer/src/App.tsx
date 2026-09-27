// Top level: pick the backend (Connect, or the development demo), then show
// the manuscript list or an open manuscript. The open manuscript lives in the
// URL (`?manuscript=path`) so reloads and links land in the same place.
import { externalStore } from "@mdbase-dev/connect";
import { Component, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

import { ConnectBackend } from "./backend/connect.js";
import type { WriterBackend } from "./backend/types.js";
import { createWriterSession, type WriterSession } from "./connect/session.js";
import { Wordmark } from "./ui/Brand.js";
import { ConnectGate } from "./ui/ConnectGate.js";
import { Home } from "./ui/Home.js";
import { applyTheme, loadTheme, type ThemePreference } from "./ui/theme.js";
import { ThemeButton, TopbarSlot } from "./ui/topbar.js";
import { WorkspaceView } from "./ui/WorkspaceView.js";
import { ManuscriptWorkspace } from "./workspace/workspace.js";

const params = new URL(location.href).searchParams;
const demoRequested = (import.meta.env.DEV || import.meta.env.VITE_WRITER_DEMO === "1") && params.has("demo");

function useManuscriptParam(): [string | null, (path: string | null) => void] {
  const [value, setValue] = useState(() => new URL(location.href).searchParams.get("manuscript"));
  useEffect(() => {
    const onPop = () => setValue(new URL(location.href).searchParams.get("manuscript"));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const set = (path: string | null) => {
    const url = new URL(location.href);
    if (path) url.searchParams.set("manuscript", path);
    else url.searchParams.delete("manuscript");
    history.pushState(history.state, "", url);
    setValue(path);
  };
  return [value, set];
}

export function App() {
  const [theme, setTheme] = useState<ThemePreference>(loadTheme);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => applyTheme(theme), [theme]);
  return (
    <TopbarSlot.Provider value={slot}>
      <div className="app">
        <header className="topbar">
          <Wordmark />
          <div className="topbar-slot" ref={setSlot} />
          <ThemeButton theme={theme} onChange={setTheme} />
        </header>
        <ErrorBoundary>{demoRequested ? <DemoRoot /> : <ConnectRoot />}</ErrorBoundary>
      </div>
    </TopbarSlot.Provider>
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="gate">
        <h1>Something went wrong</h1>
        <p>{this.state.error.message}</p>
        <p className="muted">Your saved text is in your collection. Reload to continue.</p>
        <button className="button" type="button" onClick={() => location.reload()}>Reload</button>
      </main>
    );
  }
}

// Instances with a lifetime (sessions, backends, workspaces) are created in
// the effect that disposes them, so development double-mounting cannot leave
// the UI holding a disposed one.
function useOwned<T>(create: () => T | null, dispose: (value: T) => void, deps: readonly unknown[]): T | null {
  const [value, setValue] = useState<T | null>(null);
  useEffect(() => {
    const created = create();
    setValue(created);
    return () => {
      if (created) dispose(created);
      setValue(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- callers pass the real dependencies
  }, deps);
  return value;
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
  const backend = useOwned(() => (connection ? new ConnectBackend(connection) : null), (b) => b.dispose(), [connection]);
  if (!backend) return <ConnectGate session={session} snapshot={snapshot} />;
  return <Manuscripts backend={backend} />;
}

function DemoRoot() {
  const [backend, setBackend] = useState<WriterBackend | null>(null);
  useEffect(() => {
    let live = true;
    void import("./backend/demo.js").then(async ({ createDemoBackend }) => {
      const b = await createDemoBackend();
      if (live) setBackend(b);
    });
    return () => {
      live = false;
    };
  }, []);
  if (!backend) return <main className="gate"><p className="muted" role="status">Loading the demo collection…</p></main>;
  return <Manuscripts backend={backend} />;
}

function Manuscripts({ backend }: { backend: WriterBackend }) {
  const [path, setPath] = useManuscriptParam();
  const workspace = useOwned(() => (path ? new ManuscriptWorkspace(backend, path) : null), (w) => void w.dispose(), [backend, path]);
  (window as unknown as { writer?: unknown }).writer = { backend, workspace };
  if (!path) return <Home backend={backend} onOpen={setPath} />;
  if (!workspace) return null;
  return <WorkspaceView key={workspace.main} workspace={workspace} onClose={() => setPath(null)} />;
}
