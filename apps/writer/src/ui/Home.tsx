// The collection's manuscripts, and creating a new one.
import { TEMPLATES, type TemplateName } from "@mdbase-writer/core/meta";
import { resolveLinkTarget } from "@mdbase-writer/core/records";
import { STYLES, type StyleId } from "@mdbase-writer/core/styles";
import { Select } from "@mdbase-dev/ui/select";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { ManuscriptSummary, WriterBackend } from "../backend/types.js";
import { Dialog } from "@mdbase-dev/ui/dialog";
import { chapterEmbeds } from "../workspace/chapters.js";
import { wordCount } from "../words.js";
import { PlusIcon, SearchIcon } from "./icons.js";
import { byRecentlyEdited, noteName, relativeTime, styleName, templateName } from "./names.js";

/** Manuscripts listed before a search field is worth showing. */
const SEARCH_FROM = 6;
/** Notes listed at once in the note picker. */
const NOTES_SHOWN = 8;

export function Home({ backend, onOpen }: { backend: WriterBackend; onOpen(path: string): void }) {
  const [manuscripts, setManuscripts] = useState<ManuscriptSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<TemplateName>("article");
  const [style, setStyle] = useState<StyleId>("chicago-notes-bibliography");
  const [creating, setCreating] = useState(false);
  const [notes, setNotes] = useState<string[]>([]);
  const [recordPaths, setRecordPaths] = useState<readonly string[] | null>(null);
  const [bookWords, setBookWords] = useState<ReadonlyMap<string, number>>(new Map());
  const [notePath, setNotePath] = useState("");
  const [adopting, setAdopting] = useState(false);
  const [sources, setSources] = useState<number | null>(null);
  const [dialog, setDialog] = useState(false);
  const [filter, setFilter] = useState("");
  const [untitled, setUntitled] = useState(false);
  const [adoptOpen, setAdoptOpen] = useState(false);
  const titleField = useRef<HTMLInputElement>(null);

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
      if (!live || !r.ok) return;
      setNotes([...r.value.notePaths].sort());
      setRecordPaths(r.value.recordPaths);
    });
    return () => {
      live = false;
    };
  }, [backend]);

  // A book's words are its chapters' too: read them once the list is shown.
  useEffect(() => {
    if (!manuscripts || !recordPaths) return;
    let live = true;
    const candidates = new Set(recordPaths);
    for (const m of manuscripts) {
      if (!m.chapters?.length || m.words === undefined) continue;
      void chapterWords(backend, m.path, m.chapters, candidates, new Set([m.path])).then((words) => {
        if (live) setBookWords((known) => new Map(known).set(m.path, (m.words ?? 0) + words));
      });
    }
    return () => {
      live = false;
    };
  }, [backend, manuscripts, recordPaths]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) {
      setUntitled(true);
      titleField.current?.focus();
      return;
    }
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
  const shown = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const sorted = byRecentlyEdited(manuscripts ?? []);
    return words.length ? sorted.filter((m) => words.every((w) => `${m.title} ${m.path}`.toLowerCase().includes(w))) : sorted;
  }, [manuscripts, filter]);
  const newButton = (
    <button type="button" className="mdbase-button is-primary" onClick={() => setDialog(true)}>
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
        {manuscripts && manuscripts.length >= SEARCH_FROM && (
          <label className="home-search">
            <SearchIcon />
            <input className="mdbase-field" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a manuscript" aria-label="Find a manuscript" />
          </label>
        )}
        {manuscripts && manuscripts.length > 0 && (
          <ul className="manuscripts">
            {shown.map((m) => (
              <li key={m.path}>
                <button type="button" className="manuscript-row" onClick={() => onOpen(m.path)} title={m.path}>
                  <span className="manuscript-title">{m.title}</span>
                  <span className="manuscript-meta">
                    {[
                      m.template ? templateName(m.template) : null,
                      m.style ? styleName(m.style) : null,
                      m.embeds ? `${m.embeds} ${m.embeds === 1 ? "chapter" : "chapters"}` : null,
                      wordsLabel(m.embeds ? bookWords.get(m.path) : m.words),
                      m.modified ? `edited ${relativeTime(m.modified)}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {manuscripts && manuscripts.length > 0 && !shown.length && <p className="muted">No manuscript matches “{filter}”.</p>}
        {problem && !dialog && <p className="problem" role="alert">{problem}</p>}
      </section>

      <Dialog
        open={dialog}
        onClose={() => {
          setDialog(false);
          setAdoptOpen(false);
          setUntitled(false);
        }}
        title="New manuscript"
        className="new-dialog"
      >
        <form className="new-manuscript" onSubmit={(e) => void create(e)}>
          <label className="span-2">
            Title
            <input
              ref={titleField}
              className="mdbase-field"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setUntitled(false);
              }}
              placeholder="On the limits of the possible"
              aria-invalid={untitled || undefined}
              aria-describedby={untitled ? "new-title-problem" : undefined}
              autoFocus
            />
            {untitled && <span id="new-title-problem" className="field-problem severity-error">Give the manuscript a title; it can be changed later.</span>}
          </label>
          <label>
            Layout
            <Select aria-label="Layout" value={template} options={TEMPLATES.map((t) => ({ value: t, label: templateName(t) }))} onChange={setTemplate} />
          </label>
          <label>
            Citation style
            <Select aria-label="Citation style" value={style} options={STYLES.map((s) => ({ value: s.id, label: s.title }))} onChange={setStyle} />
          </label>
          <button className="mdbase-button is-primary" type="submit" disabled={creating}>
            {creating ? "Creating…" : "Create manuscript"}
          </button>
        </form>
        {adoptOpen ? (
          <>
            <div className="or-divider" role="separator"><span>or use a note you already have</span></div>
            <form className="adopt-note" onSubmit={(e) => void adopt(e)}>
              <NotePicker notes={candidates} value={notePath} onChange={setNotePath} />
              <button className="mdbase-button" type="submit" disabled={adopting || !candidates.includes(notePath)}>
                {adopting ? "Updating…" : "Use as manuscript"}
              </button>
            </form>
            <p className="muted small">Adds the manuscript type to the note. Its other types, text and location stay as they are.</p>
          </>
        ) : (
          candidates.length > 0 && (
            <p className="adopt-offer">
              <button type="button" className="text-button" onClick={() => setAdoptOpen(true)}>
                Use a note you already have…
              </button>
            </p>
          )
        )}
        {problem && <p className="problem" role="alert">{problem}</p>}
      </Dialog>
    </main>
  );
}

const wordsLabel = (words: number | undefined) => (words === undefined ? null : `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`);

/**
 * Words in the records a body embeds on lines of their own, and in the
 * records those embed; `seen` keeps a record that embeds itself from counting twice.
 */
async function chapterWords(backend: WriterBackend, from: string, targets: readonly string[], candidates: ReadonlySet<string>, seen: Set<string>): Promise<number> {
  const counts = await Promise.all(
    targets.map(async (target) => {
      const path = resolveLinkTarget(target, from, candidates);
      if (!path || seen.has(path)) return 0;
      seen.add(path);
      const body = await backend.readBody(path);
      if (!body.ok) return 0;
      const nested = chapterEmbeds(body.value).map((e) => e.target);
      return wordCount(body.value) + (nested.length ? await chapterWords(backend, path, nested, candidates, seen) : 0);
    }),
  );
  return counts.reduce((a, b) => a + b, 0);
}

/** Finds a note by its name or folder; the notes listed are the closest matches. */
function NotePicker({ notes, value, onChange }: { notes: readonly string[]; value: string; onChange(path: string): void }) {
  const [query, setQuery] = useState("");
  const listId = useId();
  const matches = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const found = words.length ? notes.filter((p) => words.every((w) => `${noteName(p)} ${p}`.toLowerCase().includes(w))) : notes;
    return found.slice(0, NOTES_SHOWN);
  }, [notes, query]);
  const more = notes.length > NOTES_SHOWN && matches.length === NOTES_SHOWN;
  return (
    <div className="note-picker">
      <label>
        Note
        <input className="mdbase-field" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a note by name or folder" aria-controls={listId} />
      </label>
      {notes.length === 0 ? (
        <p className="muted small">No other notes in this collection.</p>
      ) : (
        <ul id={listId} className="note-list" role="listbox" aria-label="Notes">
          {matches.map((p) => {
            const folder = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
            return (
              <li key={p} role="option" aria-selected={p === value}>
                <button type="button" className="note-option" onClick={() => onChange(p)} title={p}>
                  <span className="note-name">{noteName(p)}</span>
                  {folder && <span className="note-folder">{folder}</span>}
                </button>
              </li>
            );
          })}
          {!matches.length && <li className="muted small">No note matches “{query}”.</li>}
          {more && <li className="muted small">Type to find others.</li>}
        </ul>
      )}
    </div>
  );
}
