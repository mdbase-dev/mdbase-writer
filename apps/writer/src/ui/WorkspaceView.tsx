// An open manuscript: outline, editor and preview.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { BlockPosition, WriterDiagnostic } from "../compile/protocol.js";
import { Editor, type EditorHandle } from "../editor/Editor.js";
import { Preview } from "../preview/Preview.js";
import type { ManuscriptWorkspace, RecordView, SessionSnapshot } from "../workspace/workspace.js";
import { headings } from "./outline.js";
import { Settings, type SettingsFocus } from "./Settings.js";
import { SourcesPanel } from "./SourcesPanel.js";

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

type Pane = "write" | "preview" | "outline";

function recordTitle(view: RecordView | undefined, path: string): string {
  const fm = view?.snapshot.frontmatter;
  if (typeof fm?.["title"] === "string") return fm["title"];
  const heading = /^#\s+(.+?)(?:\s*\{[^}]*\})?\s*$/m.exec(view?.snapshot.body ?? "");
  return heading?.[1] ?? path.split("/").pop()?.replace(/\.md$/, "") ?? path;
}

export function WorkspaceView({ workspace, onClose }: { workspace: ManuscriptWorkspace; onClose(): void }) {
  const snap = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot);
  const [active, setActive] = useState(workspace.main);
  const [pane, setPane] = useState<Pane>("write");
  const [exporting, setExporting] = useState<string | null>(null);
  const editor = useRef<EditorHandle | null>(null);
  const pendingReveal = useRef<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<SettingsFocus | null>(null);
  const [cursor, setCursor] = useState<{ record: string; offset: number } | null>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const order = snap.result?.order.length ? snap.result.order : [workspace.main];
  const activeView = snap.records.get(active);
  const diagnostics = snap.result?.diagnostics ?? [];
  const byRecord = useMemo(() => {
    const map = new Map<string, WriterDiagnostic[]>();
    // Problems with a setting belong to the settings panel, not to a line of the body.
    for (const d of diagnostics) if (!d.field) map.set(d.record, [...(map.get(d.record) ?? []), d]);
    return map;
  }, [diagnostics]);
  const completion = useMemo(
    () => ({ library: snap.library, labels: snap.result?.labels ?? [], recordPaths: snap.recordPaths }),
    [snap.library, snap.result?.labels, snap.recordPaths],
  );
  const manuscriptTitle = recordTitle(snap.records.get(workspace.main), workspace.main);
  const worst = [...snap.records.values()].map((r) => r.snapshot.state);
  const overall = worst.find((s) => STATE_TONE[s] === "danger") ?? worst.find((s) => STATE_TONE[s] === "pending") ?? "saved";

  useEffect(() => {
    document.title = `${manuscriptTitle} · mdbase writer`;
  }, [manuscriptTitle]);

  const showSetting = (field: SettingsFocus["field"]) => {
    setPane("outline");
    setSettingsOpen(true);
    setSettingsFocus((f) => ({ field, nonce: (f?.nonce ?? 0) + 1 }));
  };

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
    if (record === active && editor.current) editor.current.reveal(offset);
    else {
      pendingReveal.current = offset;
      setActive(record);
    }
  }, [active]);

  const onEditorReady = useCallback((handle: EditorHandle) => {
    editor.current = handle;
    if (pendingReveal.current !== null) {
      const at = pendingReveal.current;
      pendingReveal.current = null;
      requestAnimationFrame(() => handle.reveal(at));
    }
  }, []);

  const fileStem = manuscriptTitle.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "manuscript";
  const download = (bytes: Uint8Array, type: string, name: string) => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  };
  const exportPdf = async () => {
    setExporting("Exporting…");
    const out = await workspace.exportPdf();
    if (!out.bytes) {
      setExporting(out.error ?? "Export failed.");
      return;
    }
    download(out.bytes, "application/pdf", `${fileStem}.pdf`);
    setExporting(null);
  };
  const exportDocx = async () => {
    setExporting("Making the Word document… (the first export loads Pandoc, about 11 MB)");
    const out = await workspace.exportDocx();
    if (!out.bytes) {
      setExporting(out.error ?? "Export failed.");
      return;
    }
    download(out.bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", `${fileStem}.docx`);
    setExporting(out.problems.length ? `Exported with ${out.problems.length} ${out.problems.length === 1 ? "problem" : "problems"}: ${out.problems[0]}` : null);
  };
  const exportBundle = async () => {
    setExporting("Exporting…");
    const out = await workspace.exportBundle();
    download(out.bytes, "application/zip", `${fileStem} (Pandoc).zip`);
    setExporting(out.problems.length ? `Exported with ${out.problems.length} ${out.problems.length === 1 ? "problem" : "problems"}: ${out.problems[0]}` : null);
  };

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

  return (
    <div className={`workspace pane-${pane}`}>
      <div className="subbar">
        <button type="button" className="link" onClick={onClose}>
          ← Manuscripts
        </button>
        <span className="subbar-title">{manuscriptTitle}</span>
        <span className={`status tone-${STATE_TONE[overall]}`}>
          <span className="dot" aria-hidden="true" />
          {STATE_LABEL[overall]}
        </span>
        <span className="subbar-spacer" />
        {exporting && <span className="muted" role="status">{exporting}</span>}
        <button type="button" className="button link-button" onClick={() => void exportBundle()} disabled={snap.phase !== "ready"} title="The manuscript as Pandoc/Quarto Markdown with its sources, style and images (zip), to build other formats yourself">
          Pandoc bundle
        </button>
        <button type="button" className="button" onClick={() => void exportDocx()} disabled={snap.phase !== "ready"} title="A Word document (DOCX), made in your browser by Pandoc">
          Export Word
        </button>
        <button type="button" className="button" onClick={() => void exportPdf()} disabled={!snap.artifact}>
          Export PDF
        </button>
      </div>
      <nav className="pane-tabs" aria-label="View">
        {(["outline", "write", "preview"] as const).map((p) => (
          <button key={p} type="button" aria-pressed={pane === p} onClick={() => setPane(p)}>
            {p === "outline" ? "Outline" : p === "write" ? "Write" : "Preview"}
          </button>
        ))}
      </nav>

      <aside className="outline" aria-label="Manuscript outline">
        <h2>Records</h2>
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
                    {count > 0 && <span className="count" title={`${count} problems`}>{count}</span>}
                  </span>
                </button>
                <RecordHeadings body={view?.snapshot.body} onJump={(offset) => jump(path, offset)} />
              </li>
            );
          })}
        </ol>
        <SourcesPanel library={snap.library} loadAnnotations={workspace.annotations} canInsert={Boolean(activeView && activeView.snapshot.state !== "deleted")} onInsert={(text) => { setPane("write"); editor.current?.insert(text); }} />
        <Settings
          workspace={workspace}
          view={snap.records.get(workspace.main)}
          filePaths={snap.filePaths}
          problems={diagnostics}
          open={settingsOpen}
          onToggle={setSettingsOpen}
          focus={settingsFocus}
        />
        <section className="problems" aria-label="Problems">
          <h2>Problems {diagnostics.length > 0 && <span className="count">{diagnostics.length}</span>}</h2>
          {diagnostics.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <ul>
              {diagnostics.map((d, i) => (
                <li key={`${d.record}:${d.from}:${i}`}>
                  <button type="button" className={`problem-row severity-${d.severity}`} onClick={() => (d.field ? showSetting(d.field) : jump(d.record, d.from))}>
                    <span>{d.message}</span>
                    <span className="record-path">{d.field ? `Manuscript settings · ${d.field}` : d.record}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>

      <section className="write" aria-label="Editor">
        <header className="pane-header">
          <span className="pane-title">{recordTitle(activeView, active)}</span>
          <code className="pane-path">{active}</code>
        </header>
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
            onChange={(text) => workspace.setBody(active, text)}
            onReady={onEditorReady}
            onCursor={onCursor}
          />
        ) : (
          <p className="muted pad">Opening…</p>
        )}
      </section>

      <section className="preview-pane" aria-label="Preview">
        <header className="pane-header">
          <span className="pane-title">Preview</span>
          <span className="muted small">
            {snap.compiling ? "Typesetting…" : errors ? `${errors} ${errors === 1 ? "error" : "errors"}` : snap.result ? `${snap.result.meta.style} · ${snap.result.meta.template}` : ""}
            {timings && !snap.compiling ? ` · ${Math.round(timings.assembleMs + timings.compileMs)} ms` : ""}
          </span>
        </header>
        <Preview
          {...(snap.artifact ? { artifact: snap.artifact } : {})}
          {...(snap.artifactRevision !== undefined ? { revision: snap.artifactRevision } : {})}
          positions={snap.result?.positions ?? []}
          stale={Boolean(snap.result && !snap.result.artifact)}
          onJump={(p: BlockPosition) => jump(p.record, p.offset)}
          follow={follow}
        />
      </section>
    </div>
  );
}

function RecordHeadings({ body, onJump }: { body: string | undefined; onJump(offset: number): void }) {
  const list = useMemo(() => (body ? headings(body) : []), [body]);
  if (!list.length) return null;
  const top = Math.min(...list.map((h) => h.level));
  return (
    <ol className="headings">
      {list.map((h) => (
        <li key={h.offset} style={{ paddingLeft: `${(h.level - top) * 0.75}rem` }}>
          <button type="button" className="heading-row" onClick={() => onJump(h.offset)}>
            {h.text}
          </button>
        </li>
      ))}
    </ol>
  );
}
