// An open manuscript: outline, editor and preview.
import type { JsonObject } from "@mdbase-dev/connect";
import { STYLES, TEMPLATES } from "@mdbase-writer/core";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { BlockPosition, WriterDiagnostic } from "../compile/protocol.js";
import { Editor, type EditorHandle } from "../editor/Editor.js";
import { Preview } from "../preview/Preview.js";
import type { ManuscriptWorkspace, RecordView, SessionSnapshot } from "../workspace/workspace.js";

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

  const order = snap.result?.order.length ? snap.result.order : [workspace.main];
  const activeView = snap.records.get(active);
  const diagnostics = snap.result?.diagnostics ?? [];
  const byRecord = useMemo(() => {
    const map = new Map<string, WriterDiagnostic[]>();
    for (const d of diagnostics) map.set(d.record, [...(map.get(d.record) ?? []), d]);
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

  const exportPdf = async () => {
    setExporting("Exporting…");
    const out = await workspace.exportPdf();
    if (!out.bytes) {
      setExporting(out.error ?? "Export failed.");
      return;
    }
    const url = URL.createObjectURL(new Blob([out.bytes as BlobPart], { type: "application/pdf" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${manuscriptTitle.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "manuscript"}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setExporting(null);
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
              </li>
            );
          })}
        </ol>
        <Settings workspace={workspace} view={snap.records.get(workspace.main)} />
        <section className="problems" aria-label="Problems">
          <h2>Problems {diagnostics.length > 0 && <span className="count">{diagnostics.length}</span>}</h2>
          {diagnostics.length === 0 ? (
            <p className="muted">None.</p>
          ) : (
            <ul>
              {diagnostics.map((d, i) => (
                <li key={`${d.record}:${d.from}:${i}`}>
                  <button type="button" className={`problem-row severity-${d.severity}`} onClick={() => jump(d.record, d.from)}>
                    <span>{d.message}</span>
                    <span className="record-path">{d.record}</span>
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
        />
      </section>
    </div>
  );
}

function Settings({ workspace, view }: { workspace: ManuscriptWorkspace; view: RecordView | undefined }) {
  const fm = view?.snapshot.frontmatter ?? {};
  const str = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : "");
  const authors = Array.isArray(fm["authors"])
    ? (fm["authors"] as unknown[]).map((a) => (typeof a === "string" ? a : a && typeof a === "object" ? [String((a as JsonObject)["name"] ?? ""), (a as JsonObject)["affiliation"]].filter(Boolean).join("; ") : "")).join("\n")
    : "";
  const patch = (p: JsonObject) => workspace.patchFrontmatter(workspace.main, p);
  const parseAuthors = (text: string) =>
    text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name = "", affiliation] = l.split(";").map((s) => s.trim());
      return affiliation ? { name, affiliation } : { name };
    });
  if (!view) return null;
  return (
    <details className="settings">
      <summary>Manuscript settings</summary>
      <label>Title<input defaultValue={str("title")} onChange={(e) => patch({ title: e.target.value })} /></label>
      <label>Subtitle<input defaultValue={str("subtitle")} onChange={(e) => patch({ subtitle: e.target.value })} /></label>
      <label>
        Authors <span className="muted small">one per line; “Name; Affiliation”</span>
        <textarea rows={2} defaultValue={authors} onChange={(e) => patch({ authors: parseAuthors(e.target.value) })} />
      </label>
      <label>Date<input defaultValue={str("date")} onChange={(e) => patch({ date: e.target.value })} /></label>
      <label>Abstract<textarea rows={4} defaultValue={str("abstract")} onChange={(e) => patch({ abstract: e.target.value })} /></label>
      <label>
        Citation style
        <select defaultValue={str("csl") || "chicago-notes-bibliography"} onChange={(e) => patch({ csl: e.target.value })}>
          {STYLES.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        </select>
      </label>
      <label>
        Layout
        <select defaultValue={str("template") || "article"} onChange={(e) => patch({ template: e.target.value })}>
          {TEMPLATES.map((t) => <option key={t} value={t}>{t === "article" ? "Article" : "Thesis or book"}</option>)}
        </select>
      </label>
    </details>
  );
}
