import { Trans } from "@lingui/react/macro";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
// Existing manuscript navigation/workspace shared by legacy, sample and SDK
// backends. This reads only the app's manuscript route; SDK owns collection URL.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@mdbase-dev/ui/dialog";
import type { WriterBackend } from "../backend/types.js";
import { useWriterFeedbackContext } from "../FeedbackRoot.js";
import { downloadLocalDrafts } from "./download-local-drafts.js";
import { ManuscriptWorkspace } from "../workspace/workspace.js";
import { Home } from "./Home.js";
import { WorkspaceView } from "./WorkspaceView.js";
import { localNamespace, recentManuscripts, recordOpened } from "./recent.js";

function useManuscriptParam(mayLeave: () => Promise<boolean>): [string | null, (path: string | null, force?: boolean) => void] {
  const [value, setValue] = useState(() => new URL(location.href).searchParams.get("manuscript"));
  const guard = useRef(mayLeave);
  useLayoutEffect(() => {guard.current = mayLeave;}, [mayLeave]);
  const index = useRef(Number(history.state?.writerIndex ?? 0));
  const restoring = useRef(false); const navigating = useRef(false);
  const caller = useRef<AbortController | null>(null);
  useEffect(() => {
    const scope = new AbortController(); caller.current = scope;
    history.replaceState({...history.state, writerIndex: index.current}, "");
    const onPop = () => {
      const nextIndex = Number(history.state?.writerIndex ?? 0);
      if (restoring.current) {restoring.current = false; return;}
      const nextPath = new URL(location.href).searchParams.get("manuscript");
      void guard.current().then(allowed => {
        if (scope.signal.aborted) return;
        if (allowed) {index.current = nextIndex; setValue(nextPath);}
        else {const delta = index.current - nextIndex; if (delta) {restoring.current = true; history.go(delta);}}
      });
    };
    window.addEventListener("popstate", onPop);
    return () => {scope.abort(); window.removeEventListener("popstate", onPop);};
  }, []);
  const set = (path: string | null, force = false) => {
    const scope = caller.current;
    if (!scope || scope.signal.aborted || navigating.current) return;
    navigating.current = true;
    void (force ? Promise.resolve(true) : guard.current()).then(allowed => {
      if (!allowed || scope.signal.aborted) return;
      const url = new URL(location.href);
      if (path) url.searchParams.set("manuscript", path); else url.searchParams.delete("manuscript");
      history.pushState({...history.state, writerIndex: ++index.current}, "", url); setValue(path);
    }).finally(() => {navigating.current = false;});
  };
  return [value, set];
}
export function Manuscripts({backend, collectionPicker}: {backend: WriterBackend; collectionPicker?: ReactNode}) {
  useLingui();
  const currentWorkspace = useRef<ManuscriptWorkspace | null>(null);
  const [navigation, setNavigation] = useState<{message: string; finish(allowed: boolean): void} | null>(null);
  const [path, setPath] = useManuscriptParam(async () => {
    const workspace = currentWorkspace.current;
    if (!workspace || !workspace.hasUnsavedChanges()) return true;
    const saved = await workspace.retrySave(); if (saved.ok) return true;
    return new Promise<boolean>(finish => setNavigation({message: saved.message, finish}));
  });
  const [view, setView] = useState<{backend: WriterBackend; workspace: ManuscriptWorkspace | null} | null>(null);
  useEffect(() => {
    const owned = path ? new ManuscriptWorkspace(backend, path) : null;
    let active = true;
    queueMicrotask(() => {if (active) setView({backend, workspace: owned});});
    return () => {active = false; if (owned) void owned.dispose();};
  }, [backend, path]);
  const current = view?.backend === backend && view.workspace?.main === path ? view.workspace : null;
  useWriterFeedbackContext(path ? "manuscript" : "manuscripts", backend.collectionName);
  useLayoutEffect(() => {currentWorkspace.current = current;}, [current]);
  useEffect(() => {
    const target = window as unknown as {writer?: unknown};
    const owner = {backend, workspace: current}; target.writer = owner;
    return () => {if (target.writer === owner) delete target.writer;};
  }, [backend, current]);
  const since = useMemo(() => path ? recentManuscripts(localNamespace(backend)).find(entry => entry.path === path)?.at : undefined, [backend, path]);
  useEffect(() => {if (path) recordOpened(localNamespace(backend), path);}, [backend, path]);
  if (!path) return <Home backend={backend} onOpen={setPath} collectionPicker={collectionPicker} />;
  if (!current) return null;
  return <>
    <WorkspaceView key={current.main} workspace={current} since={since} onClose={force => setPath(null, force)} />
    <Dialog open={Boolean(navigation)} onClose={() => {navigation?.finish(false); setNavigation(null);}} title={t`Some changes are not saved`}>
      <p className="problem">{navigation?.message}</p><p><Trans>Download a local copy before leaving if saving cannot be completed.</Trans></p>
      <div className="compare-actions">
        <button type="button" className="mdbase-button" onClick={() => downloadLocalDrafts(current)}><Trans>Download local drafts</Trans></button>
        <button type="button" className="mdbase-button is-primary" onClick={() => {navigation?.finish(false); setNavigation(null);}}><Trans>Keep writing</Trans></button>
        <button type="button" className="mdbase-button" onClick={() => {navigation?.finish(true); setNavigation(null);}}><Trans>Leave without saving</Trans></button>
      </div>
    </Dialog>
  </>;
}
