// The collection's manuscripts, and creating a new one.
import { TEMPLATES, type TemplateName } from "@mdbase-writer/core/meta";
import { STYLES, type StyleId } from "@mdbase-writer/core/styles";
import { useEffect, useState } from "react";

import type { ManuscriptSummary, WriterBackend } from "../backend/types.js";
import { Dialog } from "./Dialog.js";
import { PlusIcon } from "./icons.js";
import { relativeTime, styleName, templateName } from "./names.js";

export function Home({ backend, onOpen }: { backend: WriterBackend; onOpen(path: string): void }) {
  const [manuscripts, setManuscripts] = useState<ManuscriptSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<TemplateName>("article");
  const [style, setStyle] = useState<StyleId>("chicago-notes-bibliography");
  const [creating, setCreating] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [notePath, setNotePath] = useState("");
  const [adopting, setAdopting] = useState(false);
  const [sources, setSources] = useState<number | null>(null);
  const [dialog, setDialog] = useState(false);

  useEffect(() => {
    let live = true;
    void backend.listManuscripts().then((r) => {
      if (!live) return;
      if (r.ok) setManuscripts(r.value);
      else setProblem(r.message);
    });
    void backend.library().then((r) => {
      if (live) setSources(r.ok ? r.value.length : 0);
    });
    void backend.index().then((r) => {
      if (live && r.ok) setNotes(r.value.recordPaths.filter((p) => p.toLowerCase().endsWith(".md")).sort());
    });
    return () => {
      live = false;
    };
  }, [backend]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setCreating(true);
    setProblem(null);
    const created = await backend.createManuscript({ title: title.trim(), template, style });
    setCreating(false);
    if (created.ok) onOpen(created.value);
    else setProblem(created.message);
  };

  const adopt = async (event: React.FormEvent) => {
    event.preventDefault();
    const path = notePath.trim();
    if (!path) return;
    setAdopting(true);
    setProblem(null);
    const adopted = await backend.adoptManuscript(path);
    setAdopting(false);
    if (adopted.ok) onOpen(adopted.value);
    else setProblem(adopted.message);
  };
  const manuscriptPaths = new Set(manuscripts?.map((m) => m.path));
  const candidates = notes.filter((p) => !manuscriptPaths.has(p));
  const newButton = (
    <button type="button" className="button primary with-icon" onClick={() => setDialog(true)}>
      <PlusIcon />
      New manuscript
    </button>
  );

  return (
    <main className="home">
      <section>
        <header className="home-header">
          <div>
            <h1>Manuscripts</h1>
            <p className="muted">
              In <strong>{backend.collectionName}</strong>
              {sources !== null && sources > 0 && <> · {sources} {sources === 1 ? "source" : "sources"} to cite from mdbase Reader</>}
            </p>
          </div>
          {manuscripts && manuscripts.length > 0 && newButton}
        </header>
        {manuscripts === null && !problem && <p className="muted" role="status">Loading…</p>}
        {manuscripts?.length === 0 && (
          <div className="first-run">
            <ol>
              <li>
                <strong>Sources.</strong>{" "}
                {sources === null
                  ? "Looking for sources…"
                  : sources > 0
                    ? `${sources} ${sources === 1 ? "source" : "sources"} from mdbase Reader can be cited here.`
                    : "None yet. Add what you read in mdbase Reader (import a PDF, a DOI or a BibTeX file); each source gets a citekey."}
              </li>
              <li>
                <strong>A manuscript.</strong> Start one, or use a note you already have. It stays an ordinary Markdown record in this collection.
              </li>
              <li>
                <strong>Write.</strong> Cite with <code>[@citekey, p. 12]</code> (or find sources by author and title in the Sources panel), label with{" "}
                <code>{"{#fig-plan}"}</code> and refer with <code>@fig-plan</code>, embed chapters with <code>![[chapters/one]]</code>. Export a PDF or a Word
                document.
              </li>
            </ol>
            {newButton}
          </div>
        )}
        {manuscripts && manuscripts.length > 0 && (
          <ul className="manuscripts">
            {manuscripts.map((m) => (
              <li key={m.path}>
                <button type="button" className="manuscript-row" onClick={() => onOpen(m.path)}>
                  <span className="manuscript-title">{m.title}</span>
                  <span className="manuscript-meta">
                    {[
                      m.template ? templateName(m.template) : null,
                      m.style ? styleName(m.style) : null,
                      m.embeds ? `${m.embeds} ${m.embeds === 1 ? "chapter" : "chapters"}` : m.words !== undefined ? `${m.words.toLocaleString()} ${m.words === 1 ? "word" : "words"}` : null,
                      m.modified ? `edited ${relativeTime(m.modified)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <code className="manuscript-path">{m.path}</code>
                </button>
              </li>
            ))}
          </ul>
        )}
        {problem && !dialog && <p className="problem" role="alert">{problem}</p>}
      </section>

      <Dialog open={dialog} onClose={() => setDialog(false)} title="New manuscript" className="new-dialog">
        <form className="new-manuscript" onSubmit={(e) => void create(e)}>
          <label className="span-2">
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="On the limits of the possible" required autoFocus />
          </label>
          <label>
            Layout
            <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateName)}>
              {TEMPLATES.map((t) => (
                <option key={t} value={t}>
                  {templateName(t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Citation style
            <select value={style} onChange={(e) => setStyle(e.target.value as StyleId)}>
              {STYLES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary" type="submit" disabled={creating || !title.trim()}>
            {creating ? "Creating…" : "Create manuscript"}
          </button>
        </form>
        <div className="or-divider" role="separator"><span>or use a note you already have</span></div>
        <form className="adopt-note" onSubmit={(e) => void adopt(e)}>
          <label>
            Note
            <input list="note-paths" value={notePath} onChange={(e) => setNotePath(e.target.value)} placeholder="drafts/on-potentiality.md" required />
            <datalist id="note-paths">
              {candidates.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </label>
          <button className="button" type="submit" disabled={adopting || !candidates.includes(notePath.trim())}>
            {adopting ? "Updating…" : "Use as manuscript"}
          </button>
        </form>
        <p className="muted small">Adds the manuscript type to the note. Its other types, text and location stay as they are.</p>
        {problem && <p className="problem" role="alert">{problem}</p>}
      </Dialog>
    </main>
  );
}
