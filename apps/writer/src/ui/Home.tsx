// The collection's manuscripts, and creating a new one.
import { STYLES, TEMPLATES, type StyleId, type TemplateName } from "@mdbase-writer/core";
import { useEffect, useState } from "react";

import type { ManuscriptSummary, WriterBackend } from "../backend/types.js";

export function Home({ backend, onOpen }: { backend: WriterBackend; onOpen(path: string): void }) {
  const [manuscripts, setManuscripts] = useState<ManuscriptSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<TemplateName>("article");
  const [style, setStyle] = useState<StyleId>("chicago-notes-bibliography");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let live = true;
    void backend.listManuscripts().then((r) => {
      if (!live) return;
      if (r.ok) setManuscripts(r.value);
      else setProblem(r.message);
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

  return (
    <main className="home">
      <section>
        <h1>Manuscripts</h1>
        <p className="muted">
          In <strong>{backend.collectionName}</strong>. A manuscript is a Markdown record; embed chapters with <code>![[path]]</code>.
        </p>
        {manuscripts === null && !problem && <p className="muted" role="status">Loading…</p>}
        {manuscripts?.length === 0 && <p>No manuscripts yet. Create one below.</p>}
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
      {problem && <p className="problem" role="alert">{problem}</p>}
    </main>
  );
}
