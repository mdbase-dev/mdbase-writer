// The collection's manuscripts, and creating a new one.
import { TEMPLATES, type TemplateName } from "@mdbase-writer/core/meta";
import { STYLES, type StyleId } from "@mdbase-writer/core/styles";
import { useEffect, useState } from "react";

import type { ManuscriptSummary, WriterBackend } from "../backend/types.js";

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

  return (
    <main className="home">
      <section>
        <h1>Manuscripts</h1>
        <p className="muted">
          In <strong>{backend.collectionName}</strong>. A manuscript is a Markdown record; embed chapters with <code>![[path]]</code>.
        </p>
        {manuscripts === null && !problem && <p className="muted" role="status">Loading…</p>}
        {manuscripts?.length === 0 && (
          <ol className="first-run">
            <li>
              <strong>Sources.</strong>{" "}
              {sources === null
                ? "Looking for sources…"
                : sources > 0
                  ? `${sources} ${sources === 1 ? "source" : "sources"} from mdbase Reader can be cited here.`
                  : "None yet. Add what you read in mdbase Reader (import a PDF, a DOI or a BibTeX file); each source gets a citekey."}
            </li>
            <li>
              <strong>A manuscript.</strong> Create one below, or use a note you already have. It stays an ordinary Markdown record in this collection.
            </li>
            <li>
              <strong>Write.</strong> Cite with <code>[@citekey, p. 12]</code> (or find sources by author and title in the Sources panel), label with{" "}
              <code>{"{#fig-plan}"}</code> and refer with <code>@fig-plan</code>, embed chapters with <code>![[chapters/one]]</code>. Export a PDF or a Word
              document.
            </li>
          </ol>
        )}
        {manuscripts && manuscripts.length > 0 && (
          <ul className="manuscripts">
            {manuscripts.map((m) => (
              <li key={m.path}>
                <button type="button" className="manuscript-row" onClick={() => onOpen(m.path)}>
                  <span className="manuscript-title">{m.title}</span>
                  <span className="manuscript-meta">
                    <code>{m.path}</code>
                    {m.template && <span>{m.template}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <h2>New manuscript</h2>
        <form className="new-manuscript" onSubmit={(e) => void create(e)}>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="On the limits of the possible" required />
          </label>
          <label>
            Layout
            <select value={template} onChange={(e) => setTemplate(e.target.value as TemplateName)}>
              {TEMPLATES.map((t) => (
                <option key={t} value={t}>
                  {t === "article" ? "Article" : "Thesis or book"}
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
      </section>
      <section>
        <h2>Use an existing note</h2>
        <p className="muted">
          Adds the manuscript type to a note you already have, wherever it lives. Its other types, text and location stay as they are.
        </p>
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
      </section>
      {problem && <p className="problem" role="alert">{problem}</p>}
    </main>
  );
}
