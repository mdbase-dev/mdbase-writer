// An open manuscript: the top bar's title, status and actions; a sidebar with
// the outline and sources; the editor and the typeset preview side by side
// (either can be hidden, and the split between them dragged).
import { annotationKey, blockQuotation, sourceAnnotation } from "@mdbase-writer/core/annotations";
import { resolveLinkTarget } from "@mdbase-writer/core/records";
import { themePreferences, type ThemePreference } from "@mdbase-dev/ui/theme";
import { memo, useCallback, useContext, useDeferredValue, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type { BlockPosition, WriterDiagnostic } from "../compile/protocol.js";
import type { ChapterCards } from "../editor/chapter-cards.js";
import type { CommentAnchor } from "../editor/comments.js";
import { Editor, type EditorHandle } from "../editor/Editor.js";
import type { SelectionAction } from "../editor/selection-bar.js";
import { authorYear } from "../editor/library-search.js";
import { ALT_LABEL, labelTargets, MOD_LABEL, referenceAtOffset, referenceKeys, referenceOffsets, type EditorInsight, type FollowTarget, type LabelTarget } from "../editor/insight.js";
import { Preview, type PreviewView } from "../preview/Preview.js";
import { wordCount } from "../words.js";
import { sourceKeys, type ManuscriptWorkspace } from "../workspace/workspace.js";
import { Dialog } from "@mdbase-dev/ui/dialog";
import {
  AlertIcon,
  CheckIcon,
  ChevronDown,
  ChevronLeft,
  CloseIcon,
  DownloadIcon,
  EditorOnly,
  GearIcon,
  MinusIcon,
  MoreIcon,
  OutlineIcon,
  PageIcon,
  PenIcon,
  PlusIcon,
  SidebarIcon,
  SplitIcon,
} from "./icons.js";
import { readerSourceHref } from "../apps.js";
import { clampSidebar, clampSplit, DEFAULT_LAYOUT, gridFor, loadLayout, nextZoom, saveLayout, SIDEBAR_MAX, SIDEBAR_MIN, type Layout, type SidebarTab, type View } from "./layout.js";
import { styleName, templateName } from "./names.js";
import { anchorsFor, placeThreads, type PlacedThread } from "./comments.js";
import { CommentsPanel, openCount, type PendingComment } from "./CommentsPanel.js";
import { OutlinePanel } from "./OutlinePanel.js";
import { CommandPalette } from "@mdbase-dev/ui/command-palette";
import { moveMenuFocus, useMenuPopover } from "@mdbase-dev/ui/popover";
import { ConnectLayout } from "@mdbase-dev/ui/screens";
import { SaveNotice } from "@mdbase-dev/ui/save-notice";
import { plural, recordTitle, STATE_LABEL, STATE_TONE } from "./records.js";
import { Settings, type SettingsFocus } from "./Settings.js";
import { SourcesPanel, type SourcesRequest } from "./SourcesPanel.js";
import { InTopbar, ThemeChoice } from "./topbar.js";

/** Which part a phone shows. */
type Pane = "outline" | "write" | "preview";
interface ExportStatus {
  readonly text: string;
  readonly tone: "busy" | "ok" | "problem";
}

type ExportFormat = "pdf" | "docx" | "bundle";
const EXPORT_NAME: Record<ExportFormat, string> = { pdf: "PDF", docx: "Word", bundle: "Pandoc bundle" };
const EXPORT_KEY = "mdbase-writer:export";
/** The format the Export button makes: the one used last (in this browser). */
function loadExportFormat(): ExportFormat {
  try {
    const saved = localStorage.getItem(EXPORT_KEY);
    return saved === "docx" || saved === "bundle" ? saved : "pdf";
  } catch {
    return "pdf";
  }
}
function saveExportFormat(format: ExportFormat): void {
  try {
    localStorage.setItem(EXPORT_KEY, format);
  } catch {
    // Storage may be blocked; the button then starts from PDF next time.
  }
}

const NO_DIAGNOSTICS: readonly WriterDiagnostic[] = [];
/** How long typing pauses before problems on the line being typed are shown. */
const SETTLE_MS = 1500;
const NO_POSITIONS: readonly BlockPosition[] = [];

const THEME_NAME: Record<ThemePreference, string> = { system: "System", light: "Light", dark: "Dark" };

const VIEW_ORDER: readonly View[] = ["both", "write", "preview"];
const VIEW_NAME: Record<View, string> = { both: "Editor and preview", write: "Editor only", preview: "Preview only" };

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const isMod = (e: KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);
/** Typing a "?" into a field or the editor is text, not a request for help. */
const isTextEntry = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest("input, textarea, [contenteditable='true']"));

/** True once `flag` has held for `delay` ms, so a quick flicker of work never shows. */
function useSustained(flag: boolean, delay: number): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!flag) {
      setHeld(false);
      return;
    }
    const t = setTimeout(() => setHeld(true), delay);
    return () => clearTimeout(t);
  }, [flag, delay]);
  return flag && held;
}

export function WorkspaceView({ workspace, onClose }: { workspace: ManuscriptWorkspace; onClose(): void }) {
  const snap = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  // Most typesets finish between keystrokes; saying so each time only flickers.
  const slowCompile = useSustained(snap.compiling, 600);
  const [active, setActive] = useState(workspace.main);
  const [pane, setPane] = useState<Pane>("write");
  const [layout, setLayoutState] = useState<Layout>(loadLayout);
  const [exportStatus, setExportStatus] = useState<ExportStatus | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<SettingsFocus | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>(loadExportFormat);
  const [moreOpen, setMoreOpen] = useState(false);
  const themeChoice = useContext(ThemeChoice);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sourcesRequest, setSourcesRequest] = useState<SourcesRequest | null>(null);
  const [previewView, setPreviewView] = useState<PreviewView | null>(null);
  const [cursor, setCursor] = useState<{ record: string; offset: number } | null>(null);
  const [pendingComment, setPendingComment] = useState<PendingComment | null>(null);
  const [activeComment, setActiveComment] = useState<string | null>(null);
  const editor = useRef<EditorHandle | null>(null);
  const pendingReveal = useRef<number | null>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const grid = useRef<HTMLDivElement>(null);
  // Where the cursor is now (the cursor state above trails it slightly), and
  // whether typing has paused, for holding back problems on the line being typed.
  const liveCursor = useRef<{ record: string; offset: number } | null>(null);
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const setLayout = useCallback((change: (l: Layout) => Layout) => {
    setLayoutState((l) => {
      const next = change(l);
      saveLayout(next);
      return next;
    });
  }, []);
  const toggleJoinLines = useCallback(() => setLayout((l) => ({ ...l, joinLines: !l.joinLines })), [setLayout]);
  const setSidebarTab = useCallback((tab: SidebarTab) => setLayout((l) => ({ ...l, tab })), [setLayout]);

  const order = snap.result?.order.length ? snap.result.order : [workspace.main];
  const activeView = snap.records.get(active);
  const allDiagnostics = snap.result?.diagnostics ?? NO_DIAGNOSTICS;
  // A citation or label half typed is not a problem yet: problems on the line
  // being typed wait until typing pauses or the cursor leaves the line.
  const diagnostics = useMemo(() => {
    const at = liveCursor.current;
    const body = at && typing ? snap.records.get(at.record)?.snapshot.body : undefined;
    if (!at || body === undefined) return allDiagnostics;
    const from = body.lastIndexOf("\n", at.offset - 1) + 1;
    const end = body.indexOf("\n", at.offset);
    const to = end < 0 ? body.length : end;
    const shown = allDiagnostics.filter((d) => d.field || d.record !== at.record || d.from < from || d.from > to);
    return shown.length === allDiagnostics.length ? allDiagnostics : shown;
  }, [allDiagnostics, typing, snap.records]);
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

  // Threads on the manuscript's records, placed in their (slightly deferred) text.
  const placed = useMemo(
    () => placeThreads(snap.comments, order, (path) => records.get(path)?.snapshot.body, snap.recordPaths),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- order is derived from the result
    [snap.comments, records, snap.recordPaths, snap.result?.order],
  );
  // Threads are placed again after every edit, but the editor's anchors follow
  // edits themselves: it is only given new ones when they change.
  const shownAnchors = useRef<{ key: string; anchors: CommentAnchor[] } | null>(null);
  const anchors = useMemo(() => {
    const next = anchorsFor(placed, active);
    const key = JSON.stringify([active, next]);
    if (shownAnchors.current?.key !== key) shownAnchors.current = { key, anchors: next };
    return shownAnchors.current.anchors;
  }, [placed, active]);

  const showComments = useCallback(() => {
    setLayout((l) => (l.sidebar && l.tab === "comments" ? l : { ...l, sidebar: true, tab: "comments" }));
    setPane("outline");
  }, [setLayout]);

  /** Starts a comment (or a suggestion) on the editor's selection; with nothing to anchor to, on the whole record. */
  const startComment = useCallback((kind: PendingComment["kind"]) => {
    const view = snap.records.get(active);
    if (!view || view.snapshot.state === "deleted") return;
    const selection = editor.current?.selection();
    setPendingComment(selection && selection.text ? { kind, record: active, draft: { record: active, body: selection.text, from: selection.from, to: selection.to } } : { kind: "comment", record: active });
    setActiveComment(null);
    showComments();
  }, [snap.records, active, showComments]);

  const selectThread = useCallback((p: PlacedThread) => {
    setActiveComment(p.thread.root.path);
    if (p.at && p.at !== "whole") jump(p.record, p.at.from);
    else if (p.record !== active) jump(p.record, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jump is declared below
  }, [active]);

  const manuscriptTitle = recordTitle(snap.records.get(workspace.main), workspace.main);
  const states = [...snap.records.values()].map((r) => r.snapshot.state);
  const overall = states.find((s) => STATE_TONE[s] === "attention") ?? states.find((s) => STATE_TONE[s] !== "saved") ?? "saved";

  useEffect(() => {
    document.title = `${manuscriptTitle} · mdbase writer`;
  }, [manuscriptTitle]);

  const showSetting = useCallback((field: SettingsFocus["field"]) => {
    setSettingsOpen(true);
    setSettingsFocus((f) => ({ field, nonce: (f?.nonce ?? 0) + 1 }));
  }, []);

  // The preview follows the cursor's block (after the cursor rests briefly).
  const onCursor = useCallback((offset: number) => {
    liveCursor.current = { record: active, offset };
    clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(() => setCursor({ record: active, offset }), 120);
  }, [active]);
  useEffect(() => () => {
    clearTimeout(cursorTimer.current);
    clearTimeout(typingTimer.current);
  }, []);
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

  // Stable handlers, so the editor and preview only render when what they show changes.
  const onEditorChange = useCallback((text: string) => {
    workspace.setBody(active, text);
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), SETTLE_MS);
  }, [workspace, active]);
  const onEditorAnchor = useCallback((id: string) => {
    setActiveComment(id);
    showComments();
  }, [showComments]);
  const onPreviewJump = useCallback((p: BlockPosition) => jump(p.record, p.offset), [jump]);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);

  const onEditorReady = useCallback((handle: EditorHandle) => {
    editor.current = handle;
    if (pendingReveal.current !== null) {
      const at = pendingReveal.current;
      pendingReveal.current = null;
      requestAnimationFrame(() => handle.reveal(at));
    }
  }, []);

  const showSources = useCallback((key?: string) => {
    setLayout((l) => (l.sidebar && l.tab === "sources" ? l : { ...l, sidebar: true, tab: "sources" }));
    setPane("outline");
    setSourcesRequest((r) => ({ ...(key ? { key } : {}), nonce: (r?.nonce ?? 0) + 1 }));
  }, [setLayout]);

  /** Sources, searching for a short passage (a name, a title) or afresh for a longer one. */
  const citePassage = useCallback((passage: string) => {
    const words = passage.replace(/[*_`“”"‘’()[\]{}.,;:!?]/g, " ").trim().split(/\s+/).filter(Boolean);
    setLayout((l) => (l.sidebar && l.tab === "sources" ? l : { ...l, sidebar: true, tab: "sources" }));
    setPane("outline");
    setSourcesRequest((r) => ({ query: words.length <= 4 ? words.join(" ") : "", nonce: (r?.nonce ?? 0) + 1 }));
  }, [setLayout]);

  const onSelectionAction = useCallback((action: SelectionAction, selected: string) => {
    if (action === "cite") citePassage(selected);
    else startComment(action);
  }, [citePassage, startComment]);

  const onFollow = useCallback((target: FollowTarget) => {
    if (target.kind === "label") jump(target.target.record, target.target.offset);
    else showSources(target.key);
  }, [jump, showSources]);

  // The next or previous citation of a source, in reading order from the cursor.
  const stepCitation = useCallback((key: string, direction: 1 | -1) => {
    const uses = order.flatMap((record) => referenceOffsets(snap.records.get(record)?.snapshot.body ?? "", key).map((offset) => ({ record, offset })));
    if (!uses.length) return;
    const here = cursor ?? { record: active, offset: -1 };
    const rank = (record: string, offset: number) => order.indexOf(record) * 1e9 + offset;
    const at = rank(here.record, here.offset);
    const next =
      direction > 0
        ? uses.find((u) => rank(u.record, u.offset) > at) ?? uses[0]
        : [...uses].reverse().find((u) => rank(u.record, u.offset) < at) ?? uses[uses.length - 1];
    if (next) jump(next.record, next.offset + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- order is derived from the result
  }, [snap.records, snap.result?.order, cursor, active, jump]);

  // The cited source under the cursor, for the sources list.
  const citedAtCursor = useMemo(() => {
    if (!cursor) return null;
    const key = referenceAtOffset(snap.records.get(cursor.record)?.snapshot.body ?? "", cursor.offset);
    return key && stats.cited.has(key) ? key : null;
  }, [cursor, snap.records, stats.cited]);

  const mainBody = snap.records.get(workspace.main)?.snapshot.body;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the manuscript's body, the index or the annotations change
  const chapters = useMemo(() => workspace.chapterPaths(), [workspace, mainBody, snap.recordPaths, snap.annotationPaths, records]);
  const recordSet = useMemo(() => new Set(snap.recordPaths), [snap.recordPaths]);
  const cards = useMemo<ChapterCards>(() => {
    const keys = sourceKeys(snap.library);
    const entries = new Map(snap.library.map((e) => [e.key, e]));
    return {
      card(target) {
        const path = resolveLinkTarget(target, active, recordSet);
        if (!path) return { path: null, title: target };
        const view = records.get(path);
        // An embedded annotation shows the quotation it renders (once loaded, and if it has one).
        const annotation = view && workspace.isQuotation(path) ? sourceAnnotation(path, view.snapshot.frontmatter, view.snapshot.body) : null;
        if (annotation?.quote) {
          const key = annotationKey(annotation, keys);
          const entry = key ? entries.get(key) : undefined;
          const cite = entry ? [authorYear(entry) || entry.key, annotation.locator].filter(Boolean).join(", ") : "";
          return { quotation: true, path, quote: annotation.quote, cite, detached: blockQuotation(key, annotation) };
        }
        return { path, title: recordTitle(view, path), ...(view ? { words: wordCount(view.snapshot.body) } : {}), problems: byRecord.get(path)?.length ?? 0 };
      },
      open(path) {
        setActive(path);
        setPane("write");
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- isQuotation reads the annotations the snapshot holds
  }, [active, recordSet, records, byRecord, snap.library, snap.annotationPaths]);
  const sourceHref = useMemo(() => (workspace.kind === "connect" ? (e: { path: string }) => readerSourceHref(e.path) : undefined), [workspace]);

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
  /** Exports, and makes this format the Export button's. */
  const runExport = (format: ExportFormat) => {
    setExportFormat(format);
    saveExportFormat(format);
    void (format === "pdf" ? exportPdf() : format === "docx" ? exportDocx() : exportBundle());
  };
  const canExport: Record<ExportFormat, boolean> = { pdf: Boolean(snap.artifact), docx: snap.phase === "ready", bundle: snap.phase === "ready" };
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    setSettingsFocus(null);
  }, []);
  // A finished export's note goes after a few seconds; a problem stays until dismissed.
  useEffect(() => {
    if (exportStatus?.tone !== "ok") return;
    // A finished export settles away (.mdbase-settle), then leaves.
    const t = setTimeout(() => setExportStatus(null), 2400);
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
    else if (mod && !e.shiftKey && e.key === ",") (settingsOpen ? closeSettings() : setSettingsOpen(true));
    else if (mod && e.altKey && e.code === "KeyM") startComment("comment");
    else if (mod && e.altKey && e.code === "KeyS") startComment("suggest");
    else if (mod && e.shiftKey && e.code === "KeyS") setExportOpen(true);
    else if (mod && !e.shiftKey && e.key.toLowerCase() === "k") setPaletteOpen(true);
    else if (mod && (e.key === "?" || (e.shiftKey && e.code === "Slash"))) setShortcutsOpen(true);
    else if (!mod && e.key === "?" && !isTextEntry(e.target)) setShortcutsOpen(true);
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
      <ConnectLayout app="writer" title="This manuscript could not be opened" error={snap.problem}>
        <button className="mdbase-connect-action" type="button" onClick={onClose}>
          Back to manuscripts
        </button>
      </ConnectLayout>
    );
  }

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const timings = snap.result?.timings;
  const { columns, areas } = gridFor(layout);

  return (
    <div
      ref={grid}
      className={`workspace pane-${pane} view-${layout.view}${layout.sidebar ? "" : " no-sidebar"}`}
      style={{ "--grid-columns": columns, "--grid-areas": areas } as React.CSSProperties}
    >
      <InTopbar>
        <div className="bar mdbase-settle-host">
          <button type="button" className="bar-back" onClick={onClose} aria-label="Manuscripts" title="All manuscripts">
            <ChevronLeft />
            <span>Manuscripts</span>
          </button>
          <span className="bar-divider" aria-hidden="true" />
          <span className="bar-title" title={manuscriptTitle}>{manuscriptTitle}</span>
          <SaveNotice tone={STATE_TONE[overall]} label={STATE_LABEL[overall]} />
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
              className="mdbase-icon-button"
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
          <button type="button" className="mdbase-button" aria-label="Settings" aria-pressed={settingsOpen} onClick={() => (settingsOpen ? closeSettings() : setSettingsOpen(true))} title={`Title, authors, abstract, citation style, layout and language (${MOD_LABEL}-,)`}>
            <GearIcon />
            <span className="button-label">Settings</span>
            {diagnostics.some((d) => d.field) && <span className="count tone-warning">{diagnostics.filter((d) => d.field).length}</span>}
          </button>
          <ExportMenu
            open={exportOpen}
            setOpen={setExportOpen}
            busy={exportStatus?.tone === "busy"}
            format={exportFormat}
            can={canExport}
            onExport={runExport}
          />
          <MoreMenu
            open={moreOpen}
            setOpen={setMoreOpen}
            onCommands={() => setPaletteOpen(true)}
            onShortcuts={() => setShortcutsOpen(true)}
            joinLines={layout.joinLines}
            onJoinLines={toggleJoinLines}
            {...(themeChoice ? { theme: themeChoice.theme, onTheme: themeChoice.setTheme } : {})}
          />
        </div>
      </InTopbar>

      <aside className="outline" aria-label="Manuscript sidebar">
        <SidebarTabs
          tab={layout.tab}
          onTab={setSidebarTab}
          sources={snap.library.length}
          comments={placed.filter((p) => p.thread.root.status === "open").length}
          commentsTitle={openCount(placed)}
        />
        <div className="sidebar-panel" role="tabpanel" id={`sidebar-${layout.tab}`} aria-labelledby={`sidebar-tab-${layout.tab}`}>
          {layout.tab === "outline" ? (
            <OutlinePanel
              main={workspace.main}
              order={order}
              records={snap.records}
              chapters={chapters}
              words={stats.words}
              byRecord={byRecord}
              active={active}
              cursor={cursor}
              onOpen={(path) => {
                setActive(path);
                setPane("write");
              }}
              onJump={jump}
              onMove={(from, to) => workspace.moveChapter(from, to)}
              onAdd={(title) => workspace.addChapter(title)}
            />
          ) : layout.tab === "comments" ? (
            <CommentsPanel
              placed={placed}
              people={snap.people}
              problem={snap.commentsProblem}
              active={activeComment}
              pending={pendingComment}
              recordTitle={(path) => recordTitle(snap.records.get(path), path)}
              onSelect={selectThread}
              onSubmit={async (text, replacement) => {
                if (!pendingComment) return { ok: true, value: null };
                const created = await workspace.addComment(pendingComment.draft ?? { record: pendingComment.record }, text, replacement);
                if (created.ok) {
                  setPendingComment(null);
                  setActiveComment(created.value.path);
                }
                return created;
              }}
              onCancel={() => setPendingComment(null)}
              onReply={(thread, text) => workspace.reply(thread, text)}
              onChange={(comment, change) => workspace.changeComment(comment, change)}
              onAccept={(p) => workspace.acceptSuggestion(p.record, p.thread.root)}
              onWholeRecord={() => {
                setPendingComment({ kind: "comment", record: active });
                setActiveComment(null);
              }}
              onCheckAccount={() => workspace.refreshPeople()}
              {...(workspace.kind === "connect" ? { onReviewAccess: () => workspace.reviewIdentityAccess() } : {})}
            />
          ) : (
            <SourcesPanel
              library={snap.library}
              cited={stats.cited}
              atCursor={citedAtCursor}
              loadAnnotations={workspace.annotations}
              canInsert={Boolean(activeView && activeView.snapshot.state !== "deleted")}
              onInsert={(text) => {
                setPane("write");
                const at = editor.current?.selection();
                const before = at && at.from === at.to ? at.text[at.from - 1] : undefined;
                editor.current?.insert(text.startsWith("[@") && before && /[^\s([{]/.test(before) ? ` ${text}` : text);
              }}
              onStepCitation={stepCitation}
              {...(sourceHref ? { sourceHref } : {})}
              request={sourcesRequest}
            />
          )}
        </div>
        <SidebarResizer width={layout.sidebarWidth} onChange={(sidebarWidth) => setLayout((l) => ({ ...l, sidebarWidth }))} />
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
            <button type="button" className="mdbase-button" onClick={() => workspace.resolveConflict(active, "mine")}>Keep mine</button>
            <button type="button" className="mdbase-button" onClick={() => workspace.resolveConflict(active, "theirs")}>Use theirs</button>
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
            joinLines={layout.joinLines}
            diagnostics={byRecord.get(active) ?? NO_DIAGNOSTICS}
            completion={completion}
            insight={insight}
            onChange={onEditorChange}
            onReady={onEditorReady}
            onCursor={onCursor}
            onFollow={onFollow}
            chapters={cards}
            onFindSource={showSources}
            anchors={anchors}
            activeComment={activeComment}
            onAnchor={onEditorAnchor}
            onSelectionAction={onSelectionAction}
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
            {slowCompile ? (
              "Typesetting…"
            ) : snap.result ? (
              <>
                {errors > 0 && <span className="preview-errors">{plural(errors, "error")} · </span>}
                <button type="button" className="preview-setting" onClick={() => showSetting("csl")} title="Change the citation style">
                  {styleName(snap.result.meta.style)}
                </button>
                <span aria-hidden="true"> · </span>
                <button type="button" className="preview-setting" onClick={() => showSetting("template")} title="Change the layout">
                  {templateName(snap.result.meta.template)}
                </button>
              </>
            ) : null}
          </span>
          <span className="bar-spacer" />
          {previewView && <span className="muted small page-indicator">Page {previewView.page} of {previewView.pages}</span>}
          <div className="zoom" role="group" aria-label="Zoom">
            <button type="button" className="mdbase-icon-button is-small" aria-label="Zoom out" onClick={() => setLayout((l) => ({ ...l, zoom: nextZoom(previewView?.scale ?? 1, -1) }))}>
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
            <button type="button" className="mdbase-icon-button is-small" aria-label="Zoom in" onClick={() => setLayout((l) => ({ ...l, zoom: nextZoom(previewView?.scale ?? 1, 1) }))}>
              <PlusIcon />
            </button>
          </div>
        </header>
        <Preview
          {...(snap.artifact ? { artifact: snap.artifact } : {})}
          {...(snap.artifactRevision !== undefined ? { revision: snap.artifactRevision } : {})}
          positions={snap.result?.positions ?? NO_POSITIONS}
          stale={Boolean(snap.result && !snap.result.artifact)}
          onJump={onPreviewJump}
          follow={follow}
          zoom={layout.zoom}
          onView={setPreviewView}
          onTitleClick={openSettings}
        />
      </section>

      <nav className="pane-tabs" aria-label="View">
        {(["outline", "write", "preview"] as const).map((p) => {
          const Icon = p === "outline" ? OutlineIcon : p === "write" ? PenIcon : PageIcon;
          return (
            <button key={p} type="button" aria-pressed={pane === p} onClick={() => setPane(p)}>
              <span className="pane-tab-icon">
                <Icon />
                {p === "write" && diagnostics.length > 0 && (
                  <span className={`tab-badge tone-${errors ? "danger" : "warning"}`} aria-label={plural(diagnostics.length, "problem")}>{diagnostics.length}</span>
                )}
              </span>
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
        onClose={closeSettings}
        focus={settingsFocus}
        joinLines={layout.joinLines}
      />
      <Shortcuts open={shortcutsOpen} onClose={closeShortcuts} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        label="Writer commands"
        commands={[
          { id: "settings", group: "Manuscript", label: "Manuscript settings", shortcut: "mod+,", run: () => setSettingsOpen(true) },
          { id: "sources", group: "Manuscript", label: "Find a source", shortcut: "mod+shift+f", run: () => showSources() },
          { id: "bold", group: "Format", label: "Bold", shortcut: "mod+b", run: () => editor.current?.format("bold") },
          { id: "italic", group: "Format", label: "Italic", shortcut: "mod+i", run: () => editor.current?.format("italic") },
          { id: "code", group: "Format", label: "Inline code", run: () => editor.current?.format("code") },
          { id: "link", group: "Format", label: "Link", shortcut: "mod+shift+k", run: () => editor.current?.format("link") },
          { id: "comment", group: "Comments", label: "Comment on the selection", shortcut: "mod+alt+m", run: () => startComment("comment") },
          { id: "suggest", group: "Comments", label: "Suggest an edit to the selection", shortcut: "mod+alt+s", keywords: "track changes", run: () => startComment("suggest") },
          { id: "comments", group: "Comments", label: "Show comments", run: showComments },
          { id: "next-problem", group: "Manuscript", label: "Next problem", shortcut: "F8", run: () => stepProblem(1) },
          { id: "manuscripts", group: "Manuscript", label: "All manuscripts", keywords: "back home close", run: onClose },
          { id: "sidebar", group: "View", label: layout.sidebar ? "Hide the sidebar" : "Show the sidebar", shortcut: "mod+\\", run: () => setLayout((l) => ({ ...l, sidebar: !l.sidebar })) },
          { id: "join-lines", group: "View", label: layout.joinLines ? "Show line breaks as written" : "Join hard-wrapped lines", keywords: "wrap reflow soft line breaks", run: toggleJoinLines },
          ...VIEW_ORDER.filter((view) => view !== layout.view).map((view) => ({ id: `view-${view}`, group: "View", label: VIEW_NAME[view], run: () => setLayout((l) => ({ ...l, view })) })),
          ...(snap.artifact ? [{ id: "export-pdf", group: "Export", label: "Export PDF", run: () => runExport("pdf") }] : []),
          { id: "export-docx", group: "Export", label: "Export Word (DOCX)", run: () => runExport("docx") },
          { id: "export-bundle", group: "Export", label: "Export Pandoc bundle (zip)", run: () => runExport("bundle") },
          ...(themeChoice
            ? themePreferences.filter((t) => t !== themeChoice.theme).map((t) => ({ id: `theme-${t}`, group: "View", label: `${THEME_NAME[t]} theme`, keywords: "appearance dark light", run: () => themeChoice.setTheme(t) }))
            : []),
          { id: "shortcuts", group: "Help", label: "Keyboard shortcuts", shortcut: "?", run: () => setShortcutsOpen(true) },
        ]}
      />
      {exportStatus && (
        <div className={`toast tone-${exportStatus.tone}${exportStatus.tone === "ok" ? " mdbase-settle" : ""}`} role={exportStatus.tone === "problem" ? "alert" : "status"}>
          {exportStatus.tone === "busy" ? <span className="spinner" aria-hidden="true" /> : exportStatus.tone === "ok" ? <CheckIcon /> : <AlertIcon />}
          <span>{exportStatus.text}</span>
          {exportStatus.tone !== "busy" && (
            <button type="button" className="mdbase-icon-button is-small" aria-label="Dismiss" onClick={() => setExportStatus(null)}>
              <CloseIcon />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Outline, Sources and Comments, as tabs: ←/→ move between them. */
function SidebarTabs({ tab, onTab, sources, comments, commentsTitle }: { tab: SidebarTab; onTab(tab: SidebarTab): void; sources: number; comments: number; commentsTitle: string }) {
  const tabs: readonly SidebarTab[] = ["outline", "sources", "comments"];
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const next = e.key === "Home" ? tabs[0] : e.key === "End" ? tabs[tabs.length - 1] : tabs[(tabs.indexOf(tab) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    if (!next) return;
    onTab(next);
    requestAnimationFrame(() => document.getElementById(`sidebar-tab-${next}`)?.focus());
  };
  return (
    <div className="sidebar-tabs" role="tablist" aria-label="Sidebar" onKeyDown={onKeyDown}>
      {tabs.map((t) => (
        <button
          key={t}
          id={`sidebar-tab-${t}`}
          type="button"
          role="tab"
          aria-selected={tab === t}
          aria-controls={`sidebar-${t}`}
          tabIndex={tab === t ? 0 : -1}
          onClick={() => onTab(t)}
          title={t === "sources" ? `Find a source (${MOD_LABEL}-Shift-F)` : t === "comments" ? commentsTitle : undefined}
        >
          {t === "outline" ? "Outline" : t === "sources" ? "Sources" : "Comments"}
          {t === "sources" && sources > 0 && <span className="tab-count">{sources}</span>}
          {t === "comments" && comments > 0 && <span className="tab-count">{comments}</span>}
        </button>
      ))}
    </div>
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

function Popover({ id, trigger, width, label, align = "start", focus, onClose, children }: { id: string; trigger: React.RefObject<HTMLElement | null>; width: number; label: string; align?: "start" | "end"; focus?: string; onClose(refocus: boolean): void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuPopover(ref, trigger, onClose, { width, align, focus });
  return (
    <div ref={ref} id={id} className="mdbase-menu popover" popover="manual" role="menu" aria-label={label} tabIndex={-1} onKeyDown={(e) => moveMenuFocus(e, ref.current)}>
      {children}
    </div>
  );
}

/** Export as a split button: the main part makes the format used last; the chevron offers them all. */
function ExportMenu(props: { open: boolean; setOpen(open: boolean): void; busy: boolean; format: ExportFormat; can: Record<ExportFormat, boolean>; onExport(format: ExportFormat): void }) {
  const { open, setOpen, busy, format, can, onExport } = props;
  const trigger = useRef<HTMLButtonElement>(null);
  const group = useRef<HTMLDivElement>(null);
  const id = useId();
  const item = (value: ExportFormat, label: string, description: string) => (
    <button
      type="button"
      role="menuitem"
      className="menu-item"
      aria-label={label}
      disabled={!can[value] || busy}
      onClick={() => {
        setOpen(false);
        onExport(value);
      }}
    >
      <strong>{label}</strong>
      <small>{description}</small>
    </button>
  );
  return (
    <>
      <div ref={group} className="split-button" role="group" aria-label="Export">
        <button
          type="button"
          className="mdbase-button is-primary"
          disabled={!can[format] || busy}
          onClick={() => onExport(format)}
          aria-label={`Export ${EXPORT_NAME[format]}`}
          title={can[format] ? `Export ${EXPORT_NAME[format]}` : format === "pdf" ? "The PDF can be exported once the manuscript typesets" : "Opening the manuscript…"}
        >
          <DownloadIcon />
          <span className="button-label">Export {EXPORT_NAME[format]}</span>
        </button>
        <button
          ref={trigger}
          type="button"
          className="mdbase-button is-primary split-toggle"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-label="Export formats"
          onClick={() => setOpen(!open)}
          title={`Export formats (${MOD_LABEL}-Shift-S)`}
        >
          <ChevronDown className="chevron" />
        </button>
      </div>
      {open && (
        <Popover id={id} trigger={group} width={320} label="Export" align="end" focus={`[role="menuitem"]:not(:disabled)`} onClose={(refocus) => {
          setOpen(false);
          if (refocus) trigger.current?.focus();
        }}>
          {item("pdf", "PDF", "Exactly as typeset in the preview")}
          {item("docx", "Word (DOCX)", "Made in your browser by Pandoc, with the layout’s Word styles. The first export downloads about 16 MB.")}
          {item("bundle", "Pandoc bundle (zip)", "Pandoc/Quarto Markdown with its sources, style and images, to build other formats yourself")}
        </Popover>
      )}
    </>
  );
}

/** Commands, keyboard shortcuts, how lines are shown and the theme, out of the bar's way. */
function MoreMenu({ open, setOpen, onCommands, onShortcuts, joinLines, onJoinLines, theme, onTheme }: { open: boolean; setOpen(open: boolean): void; onCommands(): void; onShortcuts(): void; joinLines: boolean; onJoinLines(): void; theme?: ThemePreference; onTheme?(theme: ThemePreference): void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="mdbase-icon-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label="More"
        onClick={() => setOpen(!open)}
        title="Commands, shortcuts, line breaks and theme"
      >
        <MoreIcon />
      </button>
      {open && (
        <Popover id={id} trigger={trigger} width={240} label="More" align="end" focus={`[role="menuitem"]`} onClose={(refocus) => {
          setOpen(false);
          if (refocus) trigger.current?.focus();
        }}>
          <button type="button" role="menuitem" className="menu-item is-row" onClick={run(onCommands)}>
            <span>Commands</span>
            <kbd>{MOD_LABEL} K</kbd>
          </button>
          <button type="button" role="menuitem" className="menu-item is-row" onClick={run(onShortcuts)}>
            <span>Keyboard shortcuts</span>
            <kbd>?</kbd>
          </button>
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={joinLines}
            className="menu-item is-row"
            onClick={onJoinLines}
            title="A line break inside a paragraph reads as a space; show it as one, so hard-wrapped text flows to the editor's width. The text is not changed."
          >
            <span>Join hard-wrapped lines</span>
            {joinLines && <CheckIcon />}
          </button>
          {theme && onTheme && (
            <div role="group" aria-label="Theme" className="menu-group">
              <span className="menu-label" aria-hidden="true">Theme</span>
              {themePreferences.map((t) => (
                <button key={t} type="button" role="menuitemradio" aria-checked={theme === t} className="menu-item is-row" onClick={() => onTheme(t)}>
                  <span>{THEME_NAME[t]}</span>
                  {theme === t && <CheckIcon />}
                </button>
              ))}
            </div>
          )}
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
        if (box) dragResize(e, (x) => onChange(clampSplit((x - box.left) / box.width)));
      }}
    />
  );
}

/** Follows a primary-button drag from a resize handle, reporting the pointer's x. */
function dragResize(e: React.PointerEvent<HTMLElement>, onMove: (clientX: number) => void): void {
  if (e.button !== 0) return;
  e.preventDefault();
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  document.body.classList.add("is-resizing");
  const move = (ev: PointerEvent) => onMove(ev.clientX);
  const up = () => {
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
    document.body.classList.remove("is-resizing");
  };
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}

/** The sidebar's right edge: drag, or use the arrow keys, to resize it; double-click restores its width. */
function SidebarResizer({ width, onChange }: { width: number; onChange(width: number): void }) {
  return (
    <div
      className="sidebar-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize; double-click to restore"
      onDoubleClick={() => onChange(DEFAULT_LAYOUT.sidebarWidth)}
      onKeyDown={(e) => {
        const step = e.key === "ArrowLeft" ? -16 : e.key === "ArrowRight" ? 16 : 0;
        if (step) onChange(clampSidebar(width + step));
        else if (e.key === "Home" || e.key === "End") onChange(e.key === "Home" ? SIDEBAR_MIN : SIDEBAR_MAX);
        else return;
        e.preventDefault();
      }}
      onPointerDown={(e) => {
        const left = e.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
        dragResize(e, (x) => onChange(clampSidebar(x - left)));
      }}
    />
  );
}

const SHORTCUTS: readonly [string, string][] = [
  [`${MOD_LABEL} \\`, "Show or hide the sidebar"],
  [`${MOD_LABEL} Shift \\`, "Editor and preview → editor only → preview only"],
  [`${MOD_LABEL} Shift F`, "Find a source"],
  [`${MOD_LABEL} ,`, "Manuscript settings"],
  [`${MOD_LABEL} B / ${MOD_LABEL} I`, "Bold / italic (again to remove it)"],
  [`${MOD_LABEL} Shift K`, "Make the selection a link"],
  [`${MOD_LABEL} ${ALT_LABEL} M`, "Comment on the selection"],
  [`${MOD_LABEL} ${ALT_LABEL} S`, "Suggest an edit to the selection"],
  [`${MOD_LABEL} Shift S`, "Export"],
  ["F8 / Shift F8", "Next / previous problem"],
  [`${MOD_LABEL}-click`, "On a citation: show the source. On a cross-reference: go to what it labels"],
  ["@ or [@", "Cite a source or refer to a label (by key, author, title or year)"],
  ["![[", "Embed a record"],
  [`${MOD_LABEL} F`, "Find and replace in this record"],
  [`${MOD_LABEL} K`, "Find or run a command"],
  ["?", "This list"],
];

const Shortcuts = memo(function Shortcuts({ open, onClose }: { open: boolean; onClose(): void }) {
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
});
