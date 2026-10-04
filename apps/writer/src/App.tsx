// Top level: pick the backend (Connect, the development demo, or the opt-in
// mdbase-next backend with `?next` / `?demo=next`), then show
// the manuscript list or an open manuscript. The open manuscript lives in the
// URL (`?manuscript=path`) so reloads and links land in the same place.
import { externalStore } from "@mdbase-dev/connect";
import { Component, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import { ConnectBackend } from "./backend/connect.js";
import type { NextBackend } from "./backend/next.js";
import type { NextProblem } from "./backend/next-errors.js";
import type { WriterBackend } from "./backend/types.js";
import { createWriterSession, type WriterSession } from "./connect/session.js";
import { appUrls } from "./apps.js";
import { AppSwitcher } from "@mdbase-dev/ui/app-switcher";
import { FeedbackButton, useFeedback } from "@mdbase-dev/ui/feedback";
import { useWriterFeedbackContext } from "./FeedbackRoot.js";
import { ConnectGate } from "./ui/ConnectGate.js";
import { NextGate, NextStatus } from "./ui/NextGate.js";
import { CollectionPicker } from "./ui/CollectionPicker.js";
import { Home } from "./ui/Home.js";
import { Dialog } from "@mdbase-dev/ui/dialog";
import { zip } from "./export/zip.js";
import { loadThemePreference, saveThemePreference, type ThemePreference } from "@mdbase-dev/ui/theme";
import { ThemeChoice, TopbarSlot } from "./ui/topbar.js";
import { ThemeSelect } from "@mdbase-dev/ui/theme-select";
import { ConnectLayout, OpeningScreen } from "@mdbase-dev/ui/screens";
import { WorkspaceView } from "./ui/WorkspaceView.js";
import { ManuscriptWorkspace } from "./workspace/workspace.js";


const params = new URL(location.href).searchParams;
const demoRequested = (import.meta.env.DEV || import.meta.env.VITE_WRITER_DEMO === "1") && params.has("demo");
// Opt-in: an mdbase-next collection over the relay. The default stays Connect.
const nextRequested = (import.meta.env.DEV || import.meta.env.VITE_WRITER_NEXT === "1") && params.has("next");

function useManuscriptParam(mayLeave: () => Promise<boolean>): [string | null, (path: string | null, force?: boolean) => void] {
  const [value, setValue] = useState(() => new URL(location.href).searchParams.get("manuscript"));
  const guard = useRef(mayLeave);
  guard.current = mayLeave;
  const index = useRef(Number(history.state?.writerIndex ?? 0));
  const restoring = useRef(false);
  const navigating = useRef(false);
  useEffect(() => {
    history.replaceState({ ...history.state, writerIndex: index.current }, "");
    const onPop = () => {
      const nextIndex = Number(history.state?.writerIndex ?? 0);
      if (restoring.current) { restoring.current = false; return; }
      const nextPath = new URL(location.href).searchParams.get("manuscript");
      void guard.current().then((allowed) => {
        if (allowed) { index.current = nextIndex; setValue(nextPath); }
        else {
          const delta = index.current - nextIndex;
          if (delta) { restoring.current = true; history.go(delta); }
        }
      });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const set = (path: string | null, force = false) => {
    if (navigating.current) return;
    navigating.current = true;
    void (force ? Promise.resolve(true) : guard.current()).then((allowed) => {
      if (!allowed) return;
      const url = new URL(location.href);
      if (path) url.searchParams.set("manuscript", path);
      else url.searchParams.delete("manuscript");
      history.pushState({ ...history.state, writerIndex: ++index.current }, "", url);
      setValue(path);
    }).finally(() => { navigating.current = false; });
  };
  return [value, set];
}

export function App() {
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
          <ErrorBoundary onError={() => reportError({ code: "unknown_error" })}>{demoRequested ? <DemoRoot /> : nextRequested ? <NextRoot /> : <ConnectRoot />}</ErrorBoundary>
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
        : params.get("demo") === "next"
          ? await (await import("./backend/next-demo.js")).createNextDemoBackend()
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
  return <>{backend.kind === "next" && <NextStatus backend={backend as NextBackend} />}<Manuscripts backend={backend} /></>;
}

/**
 * `?next&collection=<id>&grant=<id>`: a collection on mdbase-next. The route
 * comes from a proposed control-plane endpoint (connect/next-control.ts).
 */
function NextRoot() {
  const [backend, setBackend] = useState<NextBackend | null>(null);
  const [waiting, setWaiting] = useState<NextProblem | undefined>();
  const [problem, setProblem] = useState<NextProblem | undefined>();
  useEffect(() => {
    const abort = new AbortController();
    let owned: NextBackend | undefined;
    const collection = params.get("collection");
    // The SDK loads only in this mode.
    const errors = import("./backend/next-errors.js");
    void (async () => {
      if (!collection) throw new Error("Open Writer with ?next&collection=<collection ID>&grant=<grant ID>.");
      const [{ connectNext, proposedControlPlane }, { NextBackend }, { problemFrom }] = await Promise.all([import("./connect/next-control.js"), import("./backend/next.js"), errors]);
      const control = proposedControlPlane({ serverUrl: params.get("server") ?? import.meta.env.VITE_MDBASE_CONNECT_URL ?? "https://connect.mdbase.dev", grant: params.get("grant") });
      const client = await connectNext({ collection, control, signal: abort.signal, onWaiting: (why) => setWaiting(problemFrom(why)) });
      if (abort.signal.aborted) { client.close(); return; }
      owned = new NextBackend(client, { collectionName: params.get("name") ?? "Collection", draftNamespace: `next:${collection}`, ownsClient: true });
      setBackend(owned);
    })().catch(async (error: unknown) => {
      const { problemFrom } = await errors;
      if (abort.signal.aborted) return;
      const mapped = problemFrom(error);
      setProblem(error instanceof Error && !("code" in error) ? { ...mapped, message: error.message } : mapped);
    });
    return () => { abort.abort(); owned?.dispose(); };
  }, []);
  if (!backend) return <NextGate waiting={waiting} problem={problem} />;
  return <><NextStatus backend={backend} /><Manuscripts backend={backend} /></>;
}

function downloadLocalDrafts(workspace: ManuscriptWorkspace): void {
  const bytes = zip(workspace.localDrafts());
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "writer-local-drafts.zip";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function Manuscripts({ backend, collectionPicker }: { backend: WriterBackend; collectionPicker?: ReactNode }) {
  const currentWorkspace = useRef<ManuscriptWorkspace | null>(null);
  const [navigation, setNavigation] = useState<{ message: string; finish(allowed: boolean): void } | null>(null);
  const [path, setPath] = useManuscriptParam(async () => {
    const workspace = currentWorkspace.current;
    if (!workspace || !workspace.hasUnsavedChanges()) return true;
    const saved = await workspace.retrySave();
    if (saved.ok) return true;
    return new Promise<boolean>((finish) => setNavigation({ message: saved.message, finish }));
  });
  const workspace = useOwned(() => (path ? new ManuscriptWorkspace(backend, path) : null), (w) => void w.dispose(), [backend, path]);
  useWriterFeedbackContext(path ? "manuscript" : "manuscripts", backend.collectionName);
  currentWorkspace.current = workspace;
  (window as unknown as { writer?: unknown }).writer = { backend, workspace };
  if (!path) return <Home backend={backend} onOpen={setPath} collectionPicker={collectionPicker} />;
  if (!workspace) return null;
  return <>
    <WorkspaceView key={workspace.main} workspace={workspace} onClose={(force) => setPath(null, force)} />
    <Dialog open={Boolean(navigation)} onClose={() => { navigation?.finish(false); setNavigation(null); }} title="Some changes are not saved">
      <p className="problem">{navigation?.message}</p>
      <p>Download a local copy before leaving if saving cannot be completed.</p>
      <div className="compare-actions">
        <button type="button" className="mdbase-button" onClick={() => downloadLocalDrafts(workspace)}>Download local drafts</button>
        <button type="button" className="mdbase-button is-primary" onClick={() => { navigation?.finish(false); setNavigation(null); }}>Keep writing</button>
        <button type="button" className="mdbase-button" onClick={() => { navigation?.finish(true); setNavigation(null); }}>Leave without saving</button>
      </div>
    </Dialog>
  </>;
}
