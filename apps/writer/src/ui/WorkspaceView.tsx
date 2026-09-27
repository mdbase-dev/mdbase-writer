// An open manuscript: the top bar's title, status and actions; a sidebar with
// the outline and sources; the editor and the typeset preview side by side
// (either can be hidden, and the split between them dragged).
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type { BlockPosition, WriterDiagnostic } from "../compile/protocol.js";
import { Editor, type EditorHandle } from "../editor/Editor.js";
import { labelTargets, MOD_LABEL, referenceKeys, type EditorInsight, type FollowTarget, type LabelTarget } from "../editor/insight.js";
import { Preview, type PreviewView } from "../preview/Preview.js";
import { wordCount } from "../words.js";
import type { ManuscriptWorkspace, RecordView, SessionSnapshot } from "../workspace/workspace.js";
import { Dialog } from "./Dialog.js";
import {
  AlertIcon,
  CheckIcon,
  ChevronDown,
  ChevronLeft,
  CloseIcon,
  DownloadIcon,
  EditorOnly,
  GearIcon,
  KeyboardIcon,
  MinusIcon,
  OutlineIcon,
  PageIcon,
  PenIcon,
  PlusIcon,
  SidebarIcon,
  SplitIcon,
} from "./icons.js";
import { clampSplit, gridFor, loadLayout, nextZoom, saveLayout, type Layout, type View } from "./layout.js";
import { styleName, templateName } from "./names.js";
import { headingAt, headings, sectionWords } from "./outline.js";
import { moveMenuFocus, usePopover } from "./popover.js";
import { Settings, type SettingsFocus } from "./Settings.js";
import { SourcesPanel, type SourcesRequest } from "./SourcesPanel.js";
import { InTopbar } from "./topbar.js";

const STATE_LABEL: Record<SessionSnapshot["state"], string> = {
  saved: "Saved",
  unsaved: "Unsaved",
  saving: "Saving…",
  conflict: "Changed elsewhere",
  recovery: "Recovering save…",
  error: "Not saved",
  deleted: "Deleted elsewhere",
};
const STATE_TONE: Record<SessionSnapshot["state"], string> = {
  saved: "ok", unsaved: "pending", saving: "pending", conflict: "danger", recovery: "pending", error: "danger", deleted: "danger",
};

/** Which part a phone shows. */
type Pane = "outline" | "write" | "preview";
type SidebarTab = "outline" | "sources";
interface ExportStatus {
  readonly text: string;
  readonly tone: "busy" | "ok" | "problem";
}

const VIEW_ORDER: readonly View[] = ["both", "write", "preview"];
const VIEW_NAME: Record<View, string> = { both: "Editor and preview", write: "Editor only", preview: "Preview only" };

function recordTitle(view: RecordView | undefined, path: string): string {
  const fm = view?.snapshot.frontmatter;
  if (typeof fm?.["title"] === "string") return fm["title"];
  const heading = /^#\s+(.+?)(?:\s*\{[^}]*\})?\s*$/m.exec(view?.snapshot.body ?? "");
  return heading?.[1] ?? path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const isMod = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function WorkspaceView({ workspace, onClose }: { workspace: ManuscriptWorkspace; onClose(): void }) {
  const snap = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const [active, setActive] = useState(workspace.main);
  const [pane, setPane] = useState<Pane>("write");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("outline");
  const [layout, setLayoutState] = useState<Layout>(loadLayout);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<SettingsFocus | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [sourcesRequest, setSourcesRequest] = useState<SourcesRequest | null>(null);
  const [previewView, setPreviewView] = useState<PreviewView | null>(null);
  const [cursor, setCursor] = useState<{ record: string; offset: number } | null>(null);
  const editor = useRef<EditorHandle | null>(null);
  const pendingReveal = useRef<number | null>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const grid = useRef<HTMLDivElement>(null);

  const setLayout = useCallback((change: (l: Layout) => Layout) => {
    setLayoutState((l) => {
      const next = change(l);
      saveLayout(next);
      return next;
    });
  }, []);

  const order = snap.result?.order.length ? snap.result.order : [workspace.main];
  const activeView = snap.records.get(active);
  const diagnostics = snap.result?.diagnostics ?? [];
  const byRecord = useMemo(() => {
    const map = new Map<string, WriterDiagnostic[]>();
    // Problems with a setting belong to the settings dialog, not to a line of the body.
    for (const d of diagnostics) if (!d.field) map.set(d.record, [...(map.get(d.record) ?? []), d]);
    return map;
  }, [diagnostics]);
  const completion = useMemo(
    () => ({ library: snap.library, labels: snap.result?.labels ?? [], recordPaths: snap.recordPaths }),
    [snap.library, snap.result?.labels, snap.recordPaths],
  );

  // Counts and lookups over every record's text trail typing slightly (deferred).
  const records = useDeferredValue(snap.records);
  const stats = useMemo(() => {
    let words = 0;
    const labels = new Map<string, LabelTarget>();
    const cited = new Map<string, number>();
    const libraryKeys = new Set(snap.library.map((e) => e.key));
    for (const path of order) {
      const body = records.get(path)?.snapshot.body;
      if (body === undefined) continue;
      words += wordCount(body);
      for (const [label, target] of labelTargets(path, body)) if (!labels.has(label)) labels.set(label, target);
      for (const key of referenceKeys(body)) if (libraryKeys.has(key)) cited.set(key, (cited.get(key) ?? 0) + 1);
    }
    return { words, labels, cited };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- order is derived from the result
  }, [records, snap.library, snap.result?.order]);
  const insight = useMemo<EditorInsight>(
    () => ({
      library: new Map(snap.library.map((e) => [e.key, e])),
      references: new Map((snap.result?.references ?? []).map((r) => [r.key, r.text])),
      labels: stats.labels,
    }),
    [snap.library, snap.result?.references, stats.labels],
  );

  const manuscriptTitle = recordTitle(snap.records.get(workspace.main), workspace.main);
  const states = [...snap.records.values()].map((r) => r.snapshot.state);
  const overall = states.find((s) => STATE_TONE[s] === "danger") ?? states.find((s) => STATE_TONE[s] === "pending") ?? "saved";

  useEffect(() => {
    document.title = `${manuscriptTitle} · mdbase writer`;
  }, [manuscriptTitle]);

  const showSetting = useCallback((field: SettingsFocus["field"]) => {
    setSettingsOpen(true);
    setSettingsFocus((f) => ({ field, nonce: (f?.nonce ?? 0) + 1 }));
  }, []);

  // The preview follows the cursor's block (after the cursor rests briefly).
  const onCursor = useCallback((offset: number) => {
    clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(() => setCursor({ record: active, offset }), 120);
  }, [active]);
  useEffect(() => () => clearTimeout(cursorTimer.current), []);
  const positions = snap.result?.positions;
  const follow = useMemo(() => {
    if (!cursor || !positions) return undefined;
    let hit: BlockPosition | undefined;
    for (const p of positions) if (p.record === cursor.record && p.offset <= cursor.offset && (!hit || p.offset >= hit.offset)) hit = p;
    return hit;
  }, [cursor, positions]);

  const jump = useCallback((record: string, offset: number) => {
    setPane("write");
    setLayout((l) => (l.view === "preview" ? { ...l, view: "both" } : l));
    setCursor({ record, offset });
    if (record === active && editor.current) editor.current.reveal(offset);
    else {
      pendingReveal.current = offset;
      setActive(record);
    }
  }, [active, setLayout]);

  const onEditorReady = useCallback((handle: EditorHandle) => {
    editor.current = handle;
    if (pendingReveal.current !== null) {
      const at = pendingReveal.current;
      pendingReveal.current = null;
      requestAnimationFrame(() => handle.reveal(at));
    }
  }, []);

  const showSources = useCallback((key?: string) => {
    setLayout((l) => (l.sidebar ? l : { ...l, sidebar: true }));
    setSidebarTab("sources");
    setPane("outline");
    setSourcesRequest((r) => ({ ...(key ? { key } : {}), nonce: (r?.nonce ?? 0) + 1 }));
  }, [setLayout]);

  const onFollow = useCallback((target: FollowTarget) => {
    if (target.kind === "label") jump(target.target.record, target.target.offset);
    else showSources(target.key);
  }, [jump, showSources]);

  // Problems in reading order, for F8 / Shift-F8.
  const bodyProblems = useMemo(
    () => diagnostics.filter((d) => !d.field).slice().sort((a, b) => order.indexOf(a.record) - order.indexOf(b.record) || a.from - b.from),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- order is derived from the result
    [diagnostics, snap.result?.order],
  );
  const stepProblem = useCallback((direction: 1 | -1) => {
    if (!bodyProblems.length) return;
    const here = cursor ?? { record: active, offset: -1 };
    const rank = (record: string, offset: number) => order.indexOf(record) * 1e9 + offset;
    const at = rank(here.record, here.offset);
    const next =
      direction > 0
        ? bodyProblems.find((d) => rank(d.record, d.from) > at) ?? bodyProblems[0]
        : [...bodyProblems].reverse().find((d) => rank(d.record, d.from) < at) ?? bodyProblems[bodyProblems.length - 1];
    if (next) jump(next.record, next.from);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- order is derived from the result
  }, [bodyProblems, cursor, active, jump, snap.result?.order]);

  const fileStem = manuscriptTitle.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "manuscript";
  const download = (bytes: Uint8Array, type: string, name: string) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const exported = (name: string, problems: readonly string[]) =>
    setExportStatus(
      problems.length
        ? { tone: "problem", text: `Exported ${name} with ${plural(problems.length, "problem")}: ${problems[0]}` }
        : { tone: "ok", text: `Exported ${name}.` },
    );
  const exportPdf = async () => {
    setExportStatus({ tone: "busy", text: "Exporting the PDF…" });
    const out = await workspace.exportPdf();
    if (!out.bytes) return setExportStatus({ tone: "problem", text: out.error ?? "Export failed." });
    download(out.bytes, "application/pdf", `${fileStem}.pdf`);
    exported("the PDF", []);
  };
  const exportDocx = async () => {
    setExportStatus({ tone: "busy", text: "Making the Word document… (the first export loads Pandoc, about 16 MB)" });
    const out = await workspace.exportDocx();
    if (!out.bytes) return setExportStatus({ tone: "problem", text: out.error ?? "Export failed." });
    download(out.bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `${fileStem}.docx`);
    exported("the Word document", out.problems);
  };
  const exportBundle = async () => {
    setExportStatus({ tone: "busy", text: "Making the Pandoc bundle…" });
    const out = await workspace.exportBundle();
    download(out.bytes, "application/zip", `${fileStem} (Pandoc).zip`);
    exported("the Pandoc bundle", out.problems);
  };
  // A finished export's note goes after a few seconds; a problem stays until dismissed.
  useEffect(() => {
    if (exportStatus?.tone !== "ok") return;
    const t = setTimeout(() => setExportStatus(null), 4000);
    return () => clearTimeout(t);
  }, [exportStatus]);

  // Keyboard shortcuts (listed in the shortcuts dialog).
  const shortcuts = useRef<(e: KeyboardEvent) => void>(() => {});
  shortcuts.current = (e: KeyboardEvent) => {
    if (document.querySelector("dialog[open]") && e.key !== "F8") return;
    const mod = isMod(e);
    let handled = true;
    if (mod && !e.shiftKey && e.code === "Backslash") setLayout((l) => ({ ...l, sidebar: !l.sidebar }));
    else if (mod && e.shiftKey && e.code === "Backslash") setLayout((l) => ({ ...l, view: VIEW_ORDER[(VIEW_ORDER.indexOf(l.view) + 1) % VIEW_ORDER.length] as View }));
    else if (mod && e.shiftKey && e.code === "KeyF") showSources();
    else if (mod && !e.shiftKey && e.key === ",") setSettingsOpen(true);
    else if (mod && e.shiftKey && e.code === "KeyS") setExportOpen(true);
    else if (mod && (e.key === "?" || (e.shiftKey && e.code === "Slash"))) setShortcutsOpen(true);
    else if (e.key === "F8" && !mod) stepProblem(e.shiftKey ? -1 : 1);
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  useEffect(() => {
    const listener = (e: KeyboardEvent) => shortcuts.current(e);
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  }, []);

  if (snap.phase === "failed") {
    return (
      <main className="gate">
        <h1>This manuscript could not be opened</h1>
        <p>{snap.problem}</p>
        <button className="button" type="button" onClick={onClose}>
          Back to manuscripts
        </button>
      </main>
    );
  }

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const timings = snap.result?.timings;
  const { columns, areas } = gridFor(layout);
  const cursorHeading = cursor ? { record: cursor.record, offset: cursor.offset } : null;

  return (
    <div
      ref={grid}
      className={`workspace pane-${pane} view-${layout.view}${layout.sidebar ? "" : " no-sidebar"}`}
      style={{ "--grid-columns": columns, "--grid-areas": areas } as React.CSSProperties}
    >
      <InTopbar>
        <div className="bar">
          <button type="button" className="bar-back" onClick={onClose} aria-label="Manuscripts" title="All manuscripts">
            <ChevronLeft />
            <span>Manuscripts</span>
          </button>
          <span className="bar-divider" aria-hidden="true" />
          <span className="bar-title" title={manuscriptTitle}>{manuscriptTitle}</span>
          <span className={`status tone-${STATE_TONE[overall]}`} role="status">
            <span className="dot" aria-hidden="true" />
            <span className="status-text">{STATE_LABEL[overall]}</span>
          </span>
          <span className="bar-words" title={`In ${plural(order.length, "record")}; citations, code and math are not counted`}>
            {plural(stats.words, "word")}
          </span>
          <ProblemsButton
            diagnostics={diagnostics}
            open={problemsOpen}
            setOpen={setProblemsOpen}
            onPick={(d) => (d.field ? showSetting(d.field) : jump(d.record, d.from))}
          />
          <span className="bar-spacer" />
          <div className="bar-layout" role="group" aria-label="Layout">
            <button
              type="button"
              className="icon-button"
              aria-pressed={layout.sidebar}
              onClick={() => setLayout((l) => ({ ...l, sidebar: !l.sidebar }))}
              title={`${layout.sidebar ? "Hide" : "Show"} the sidebar (${MOD_LABEL}-\\)`}
              aria-label="Sidebar"
            >
              <SidebarIcon />
            </button>
            <div className="segmented icons" role="group" aria-label="Editor and preview">
              {VIEW_ORDER.map((v) => {
                const Icon = v === "both" ? SplitIcon : v === "write" ? EditorOnly : PageIcon;
                return (
                  <button key={v} type="button" aria-pressed={layout.view === v} onClick={() => setLayout((l) => ({ ...l, view: v }))} aria-label={VIEW_NAME[v]} title={`${VIEW_NAME[v]} (${MOD_LABEL}-Shift-\\ cycles)`}>
                    <Icon />
                  </button>
                );
              })}
            </div>
          </div>
          <button type="button" className="icon-button bar-shortcuts" onClick={() => setShortcutsOpen(true)} aria-label="Keyboard shortcuts" title={`Keyboard shortcuts (${MOD_LABEL}-?)`}>
            <KeyboardIcon />
          </button>
          <button type="button" className="button with-icon" aria-label="Settings" onClick={() => setSettingsOpen(true)} title={`Title, authors, abstract, citation style, layout and language (${MOD_LABEL}-,)`}>
            <GearIcon />
            <span className="button-label">Settings</span>
            {diagnostics.some((d) => d.field) && <span className="count tone-warning">{diagnostics.filter((d) => d.field).length}</span>}
          </button>
          <ExportMenu
            open={exportOpen}
            setOpen={setExportOpen}
            busy={exportStatus?.tone === "busy"}
            canPdf={Boolean(snap.artifact)}
            ready={snap.phase === "ready"}
            onPdf={() => void exportPdf()}
            onDocx={() => void exportDocx()}
            onBundle={() => void exportBundle()}
          />
        </div>
      </InTopbar>

      <aside className="outline" aria-label="Manuscript sidebar">
        <div className="segmented sidebar-tabs" role="tablist" aria-label="Sidebar">
          <button type="button" role="tab" aria-selected={sidebarTab === "outline"} onClick={() => setSidebarTab("outline")}>
            Outline
          </button>
          <button type="button" role="tab" aria-selected={sidebarTab === "sources"} onClick={() => setSidebarTab("sources")} title={`Find a source (${MOD_LABEL}-Shift-F)`}>
            Sources {snap.library.length > 0 && <span className="count">{snap.library.length}</span>}
          </button>
        </div>
        {sidebarTab === "outline" ? (
          <ol className="records">
            {order.map((path) => {
              const view = snap.records.get(path);
              const count = byRecord.get(path)?.length ?? 0;
              const state = view?.snapshot.state;
              return (
                <li key={path}>
                  <button type="button" className="record-row" aria-current={path === active ? "true" : undefined} onClick={() => { setActive(path); setPane("write"); }}>
                    <span className="record-name">{recordTitle(view, path)}</span>
                    <span className="record-path">{path}</span>
                    <span className="record-state">
                      {state && state !== "saved" && <span className={`status tone-${STATE_TONE[state]}`}><span className="dot" aria-hidden="true" />{STATE_LABEL[state]}</span>}
                      {count > 0 && <span className="count tone-warning" title={plural(count, "problem")}>{count}</span>}
                    </span>
                  </button>
                  <RecordHeadings
                    body={view?.snapshot.body}
                    current={cursorHeading?.record === path ? cursorHeading.offset : null}
                    onJump={(offset) => jump(path, offset)}
                  />
                </li>
              );
            })}
          </ol>
        ) : (
          <SourcesPanel
            library={snap.library}
            cited={stats.cited}
            loadAnnotations={workspace.annotations}
            canInsert={Boolean(activeView && activeView.snapshot.state !== "deleted")}
            onInsert={(text) => {
              setPane("write");
              editor.current?.insert(text);
            }}
            request={sourcesRequest}
          />
        )}
      </aside>

      <section className="write" aria-label="Editor">
        {active !== workspace.main && (
          <header className="pane-header">
            <button type="button" className="link small" onClick={() => setActive(workspace.main)}>
              ← {recordTitle(snap.records.get(workspace.main), workspace.main)}
            </button>
            <span className="pane-title">{recordTitle(activeView, active)}</span>
            <code className="pane-path">{active}</code>
          </header>
        )}
        {activeView?.snapshot.state === "conflict" && (
          <div className="banner" role="alert">
            <span>This record changed elsewhere while you were editing it.</span>
            <button type="button" className="button" onClick={() => workspace.resolveConflict(active, "mine")}>Keep mine</button>
            <button type="button" className="button" onClick={() => workspace.resolveConflict(active, "theirs")}>Use theirs</button>
          </div>
        )}
        {activeView?.snapshot.state === "error" && activeView.snapshot.problem && (
          <div className="banner" role="alert">
            <span>Not saved: {activeView.snapshot.problem.message ?? activeView.snapshot.problem.code}. Your text is kept; saving retries when you type.</span>
          </div>
        )}
        {activeView ? (
          <Editor
            key={active}
            path={active}
            text={activeView.snapshot.body}
            readOnly={activeView.snapshot.state === "deleted"}
            diagnostics={byRecord.get(active) ?? []}
            completion={completion}
            insight={insight}
            onChange={(text) => workspace.setBody(active, text)}
            onReady={onEditorReady}
            onCursor={onCursor}
            onFollow={onFollow}
          />
        ) : (
          <p className="muted pad">Opening…</p>
        )}
      </section>

      <Divider
        split={layout.split}
        grid={grid}
        onChange={(split) => setLayout((l) => ({ ...l, split }))}
      />

      <section className="preview-pane" aria-label="Preview">
        <header className="pane-header preview-header">
          <span
            className="muted small preview-meta"
            title={timings && !snap.compiling ? `Typeset in ${Math.round(timings.assembleMs + timings.compileMs)} ms` : undefined}
          >
            {snap.compiling ? "Typesetting…" : errors ? plural(errors, "error") : snap.result ? `${styleName(snap.result.meta.style)} · ${templateName(snap.result.meta.template)}` : ""}
          </span>
          <span className="bar-spacer" />
          {previewView && <span className="muted small page-indicator">Page {previewView.page} of {previewView.pages}</span>}
          <div className="zoom" role="group" aria-label="Zoom">
            <button type="button" className="icon-button small" aria-label="Zoom out" onClick={() => setLayout((l) => ({ ...l, zoom: nextZoom(previewView?.scale ?? 1, -1) }))}>
              <MinusIcon />
            </button>
            <button
              type="button"
              className="zoom-value"
              onClick={() => setLayout((l) => ({ ...l, zoom: l.zoom === "fit" ? 1 : "fit" }))}
              title={layout.zoom === "fit" ? "Fitting the width; click for actual size" : "Click to fit the width"}
            >
              {layout.zoom === "fit" ? `Fit · ${Math.round((previewView?.scale ?? 1) * 100)}%` : `${Math.round(layout.zoom * 100)}%`}
            </button>
            <button type="button" className="icon-button small" aria-label="Zoom in" onClick={() => setLayout((l) => ({ ...l, zoom: nextZoom(previewView?.scale ?? 1, 1) }))}>
              <PlusIcon />
            </button>
          </div>
        </header>
        <Preview
          {...(snap.artifact ? { artifact: snap.artifact } : {})}
          {...(snap.artifactRevision !== undefined ? { revision: snap.artifactRevision } : {})}
          positions={snap.result?.positions ?? []}
          stale={Boolean(snap.result && !snap.result.artifact)}
          onJump={(p: BlockPosition) => jump(p.record, p.offset)}
          follow={follow}
          zoom={layout.zoom}
          onView={setPreviewView}
          onTitleClick={() => setSettingsOpen(true)}
        />
      </section>

      <nav className="pane-tabs" aria-label="View">
        {(["outline", "write", "preview"] as const).map((p) => {
          const Icon = p === "outline" ? OutlineIcon : p === "write" ? PenIcon : PageIcon;
          return (
            <button key={p} type="button" aria-pressed={pane === p} onClick={() => setPane(p)}>
              <Icon />
              {p === "outline" ? "Outline" : p === "write" ? "Write" : "Preview"}
            </button>
          );
        })}
      </nav>

      <Settings
        workspace={workspace}
        view={snap.records.get(workspace.main)}
        filePaths={snap.filePaths}
        problems={diagnostics}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        focus={settingsFocus}
      />
      <Shortcuts open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      {exportStatus && (
        <div className={`toast tone-${exportStatus.tone}`} role={exportStatus.tone === "problem" ? "alert" : "status"}>
          {exportStatus.tone === "busy" ? <span className="spinner" aria-hidden="true" /> : exportStatus.tone === "ok" ? <CheckIcon /> : <AlertIcon />}
          <span>{exportStatus.text}</span>
          {exportStatus.tone !== "busy" && (
            <button type="button" className="icon-button small" aria-label="Dismiss" onClick={() => setExportStatus(null)}>
              <CloseIcon />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RecordHeadings({ body, current, onJump }: { body: string | undefined; current: number | null; onJump(offset: number): void }) {
  const list = useMemo(() => (body ? headings(body) : []), [body]);
  const words = useMemo(() => (body ? sectionWords(body, list) : []), [body, list]);
  const here = current === null ? undefined : headingAt(list, current);
  const activeRow = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [here?.offset]);
  if (!list.length) return null;
  const top = Math.min(...list.map((h) => h.level));
  return (
    <ol className="headings">
      {list.map((h, i) => (
        <li key={h.offset} style={{ paddingLeft: `${(h.level - top) * 0.75}rem` }}>
          <button
            ref={h === here ? activeRow : undefined}
            type="button"
            className="heading-row"
            aria-current={h === here ? "location" : undefined}
            onClick={() => onJump(h.offset)}
          >
            <span className="heading-text">{h.text}</span>
            <span className="heading-words" title={`${plural(words[i] ?? 0, "word")} in this section`}>{(words[i] ?? 0).toLocaleString()}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function ProblemsButton({ diagnostics, open, setOpen, onPick }: { diagnostics: readonly WriterDiagnostic[]; open: boolean; setOpen(open: boolean): void; onPick(d: WriterDiagnostic): void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  if (!diagnostics.length) {
    return (
      <span className="bar-problems is-clear" title="No problems">
        <CheckIcon />
        <span className="button-label">No problems</span>
      </span>
    );
  }
  const errors = diagnostics.some((d) => d.severity === "error");
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`bar-problems tone-${errors ? "danger" : "warning"}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={plural(diagnostics.length, "problem")}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        title="Show problems (F8 goes to the next one)"
      >
        <AlertIcon />
        <span>{diagnostics.length}</span>
        <span className="button-label">{diagnostics.length === 1 ? "problem" : "problems"}</span>
      </button>
      {open && (
        <Popover id={id} trigger={trigger} width={420} label="Problems" onClose={(refocus) => {
          setOpen(false);
          if (refocus) trigger.current?.focus();
        }}>
          <ul className="problems">
            {diagnostics.map((d, i) => (
              <li key={`${d.record}:${d.from}:${i}`}>
                <button
                  type="button"
                  role="menuitem"
                  className={`problem-row severity-${d.severity}`}
                  onClick={() => {
                    setOpen(false);
                    onPick(d);
                  }}
                >
                  <span>{d.message}</span>
                  <span className="record-path">{d.field ? `Manuscript settings · ${d.field}` : d.record}</span>
                </button>
              </li>
            ))}
          </ul>
          <p className="popover-note">F8 and Shift-F8 step through problems in the text.</p>
        </Popover>
      )}
    </>
  );
}

function Popover({ id, trigger, width, label, align = "start", onClose, children }: { id: string; trigger: React.RefObject<HTMLElement | null>; width: number; label: string; align?: "start" | "end"; onClose(refocus: boolean): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  usePopover(ref, trigger, onClose, { width, align });
  return (
    <div ref={ref} id={id} className="app-menu popover" popover="manual" role="menu" aria-label={label} tabIndex={-1} onKeyDown={(e) => moveMenuFocus(e, ref.current)}>
      {children}
    </div>
  );
}

function ExportMenu(props: { open: boolean; setOpen(open: boolean): void; busy: boolean; canPdf: boolean; ready: boolean; onPdf(): void; onDocx(): void; onBundle(): void }) {
  const { open, setOpen, busy } = props;
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const item = (label: string, description: string, enabled: boolean, run: () => void) => (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      aria-label={label}
      disabled={!enabled || busy}
      onClick={() => {
        setOpen(false);
        run();
      }}
    >
      <strong>{label}</strong>
      <small>{description}</small>
    </button>
  );
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="button primary with-icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label="Export"
        onClick={() => setOpen(!open)}
        title={`Export (${MOD_LABEL}-Shift-S)`}
      >
        <DownloadIcon />
        <span className="button-label">Export</span>
        <ChevronDown className="chevron" />
      </button>
      {open && (
        <Popover id={id} trigger={trigger} width={320} label="Export" align="end" onClose={(refocus) => {
          setOpen(false);
          if (refocus) trigger.current?.focus();
        }}>
          {item("PDF", "Exactly as typeset in the preview", props.canPdf, props.onPdf)}
          {item("Word (DOCX)", "Made in your browser by Pandoc, with the layout’s Word styles. The first export downloads about 16 MB.", props.ready, props.onDocx)}
          {item("Pandoc bundle (zip)", "Pandoc/Quarto Markdown with its sources, style and images, to build other formats yourself", props.ready, props.onBundle)}
        </Popover>
      )}
    </>
  );
}

function Divider({ split, grid, onChange }: { split: number; grid: React.RefObject<HTMLDivElement | null>; onChange(split: number): void }) {
  const measure = () => {
    const write = grid.current?.querySelector<HTMLElement>(".write")?.getBoundingClientRect();
    const preview = grid.current?.querySelector<HTMLElement>(".preview-pane")?.getBoundingClientRect();
    return write && preview ? { left: write.left, width: preview.right - write.left } : null;
  };
  return (
    <div
      className="divider"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the editor and preview"
      aria-valuemin={20}
      aria-valuemax={80}
      aria-valuenow={Math.round(split * 100)}
      tabIndex={0}
      title="Drag to resize; double-click to split evenly"
      onDoubleClick={() => onChange(0.5)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowLeft" ? -0.05 : e.key === "ArrowRight" ? 0.05 : 0;
        if (step) {
          e.preventDefault();
          onChange(clampSplit(split + step));
        } else if (e.key === "Home" || e.key === "End") {
          e.preventDefault();
          onChange(e.key === "Home" ? 0.2 : 0.8);
        }
      }}
      onPointerDown={(e) => {
        const box = measure();
        if (!box || e.button !== 0) return;
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        document.body.classList.add("is-resizing");
        const move = (ev: PointerEvent) => onChange(clampSplit((ev.clientX - box.left) / box.width));
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          document.body.classList.remove("is-resizing");
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
    />
  );
}

const SHORTCUTS: readonly [string, string][] = [
  [`${MOD_LABEL} \\`, "Show or hide the sidebar"],
  [`${MOD_LABEL} Shift \\`, "Editor and preview → editor only → preview only"],
  [`${MOD_LABEL} Shift F`, "Find a source"],
  [`${MOD_LABEL} ,`, "Manuscript settings"],
  [`${MOD_LABEL} Shift S`, "Export"],
  ["F8 / Shift F8", "Next / previous problem"],
  [`${MOD_LABEL}-click`, "On a citation: show the source. On a cross-reference: go to what it labels"],
  ["@ or [@", "Cite a source or refer to a label (by key, author, title or year)"],
  ["![[", "Embed a record"],
  [`${MOD_LABEL} F`, "Find and replace in this record"],
  [`${MOD_LABEL} ?`, "This list"],
];

function Shortcuts({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" className="shortcuts-dialog">
      <dl className="shortcuts">
        {SHORTCUTS.map(([keys, what]) => (
          <div key={keys}>
            <dt><kbd>{keys}</kbd></dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
    </Dialog>
  );
}
