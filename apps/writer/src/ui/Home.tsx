// The collection's manuscripts, and creating a new one.
import { TEMPLATES, type TemplateName } from "@mdbase-writer/core/meta";
import { PathIndex, resolveLinkTarget } from "@mdbase-writer/core/records";
import { STYLES, type StyleId } from "@mdbase-writer/core/styles";
import { Select } from "@mdbase-dev/ui/select";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { bodySummary, fail, type ManuscriptSummary, type Result, type WriterBackend } from "../backend/types.js";
import { errorMessage, limitConcurrency, mapConcurrent } from "../async.js";
import { readerSourceHref } from "../apps.js";
import { Dialog } from "@mdbase-dev/ui/dialog";
import { chapterEmbeds } from "../workspace/chapters.js";
import { wordCount } from "../words.js";
import { PlusIcon, SearchIcon } from "./icons.js";
import { byRecentlyEdited, noteName, relativeTime, styleName, templateName } from "./names.js";

/** Manuscripts listed before a search field is worth showing. */
const SEARCH_FROM = 6;
/** Notes listed at once in the note picker. */
const NOTES_SHOWN = 8;
const TEMPLATE_OPTIONS = TEMPLATES.map((t) => ({ value: t, label: templateName(t) }));
const STYLE_OPTIONS = STYLES.map((s) => ({ value: s.id, label: s.title }));

export function Home({ backend, onOpen, collectionPicker }: { backend: WriterBackend; onOpen(path: string): void; collectionPicker?: ReactNode }) {
  const [manuscripts, setManuscripts] = useState<ManuscriptSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [backgroundProblem, setBackgroundProblem] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [recordPaths, setRecordPaths] = useState<readonly string[] | null>(null);
  const [summaries, setSummaries] = useState<ReadonlyMap<string, Pick<ManuscriptSummary, "words" | "embeds" | "chapters">>>(new Map());
  const [visiblePaths, setVisiblePaths] = useState<ReadonlySet<string>>(new Set());
  const [reload, setReload] = useState(0);
  const bodyCache = useRef(new Map<string, Promise<Result<string>>>());
  const rows = useRef<HTMLUListElement>(null);
  const limitReads = useMemo(() => limitConcurrency(4), [backend]);
  const [sources, setSources] = useState<number | null>(null);
  const [dialog, setDialog] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    let live = true;
    setProblem(null);
    setBackgroundProblem(null);
    const pending = backend.flushChanges?.() ?? Promise.resolve();
    void pending.then(() => backend.listManuscripts()).then((r) => {
      if (!live) return;
      if (r.ok) setManuscripts(r.value);
      else setProblem(r.message);
    }).catch((error: unknown) => { if (live) setProblem(errorMessage(error)); });
    void pending.then(() => backend.library()).then((r) => {
      if (!live) return;
      if (r.ok) setSources(r.value.length);
      else setBackgroundProblem(`Sources could not be loaded: ${r.message}`);
    }).catch((error: unknown) => { if (live) setBackgroundProblem(errorMessage(error)); });
    void pending.then(() => backend.index()).then((r) => {
      if (!live) return;
      if (!r.ok) { setBackgroundProblem(`Index could not be loaded: ${r.message}`); return; }
      setNotes([...r.value.notePaths].sort());
      setRecordPaths(r.value.recordPaths);
    }).catch((error: unknown) => { if (live) setBackgroundProblem(errorMessage(error)); });
    return () => {
      live = false;
    };
  }, [backend, reload]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = (paths: readonly string[] = []) => {
      for (const path of paths) bodyCache.current.delete(path);
      clearTimeout(timer);
      timer = setTimeout(() => { setReload((value) => value + 1); }, 50);
    };
    const stop = backend.onCollectionChange
      ? backend.onCollectionChange((delta) => {
        if (delta.problem) { setBackgroundProblem(delta.problem); return; }
        if (delta.reset) { bodyCache.current.clear(); setSummaries(new Map()); }
        refresh(delta.paths);
      })
      : backend.onExternalChange(refresh);
    const focus = () => { void backend.flushChanges?.().then(() => refresh()); };
    window.addEventListener("focus", focus);
    return () => { stop(); clearTimeout(timer); window.removeEventListener("focus", focus); };
  }, [backend]);

  const recordIndex = useMemo(() => new PathIndex(recordPaths ?? []), [recordPaths]);

  // Bodies are only read for visible rows, at most four concurrent manuscript traversals.
  useEffect(() => {
    if (!manuscripts || !recordPaths) return;
    let live = true;
    const read = (path: string) => {
      if (!live) return Promise.resolve(fail<string>("Counting cancelled."));
      let cached = bodyCache.current.get(path);
      if (!cached) { cached = limitReads(() => backend.readBody(path)); bodyCache.current.set(path, cached); }
      return cached;
    };
    const candidates = recordIndex;
    void mapConcurrent(manuscripts.filter((m) => visiblePaths.has(m.path)), 4, async (m) => {
      if (!live) return;
      const body = await read(m.path);
      if (!body.ok || !live) return;
      const summary = bodySummary(body.value);
      const words = (summary.words ?? 0) + await chapterWords(read, m.path, summary.chapters ?? [], candidates, new Set([m.path]));
      if (live) setSummaries((known) => new Map(known).set(m.path, { ...summary, words }));
    }).catch(() => { /* Counts are optional; failed body reads never hide a title. */ });
    return () => { live = false; };
  }, [backend, manuscripts, recordPaths, recordIndex, visiblePaths, limitReads, reload]);

  const candidates = useMemo(() => {
    const manuscriptPaths = new Set(manuscripts?.map((m) => m.path));
    return notes.filter((p) => !manuscriptPaths.has(p));
  }, [notes, manuscripts]);
  const shown = useMemo(() => {
    const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
    const sorted = byRecentlyEdited(manuscripts ?? []);
    return words.length ? sorted.filter((m) => words.every((w) => `${m.title} ${m.path}`.toLowerCase().includes(w))) : sorted;
  }, [manuscripts, filter]);
  useEffect(() => {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).map((entry) => (entry.target as HTMLElement).dataset["path"]).filter((path): path is string => Boolean(path));
      if (visible.length) setVisiblePaths((previous) => visible.every((path) => previous.has(path)) ? previous : new Set([...previous, ...visible]));
    }, { rootMargin: "200px" });
    rows.current?.querySelectorAll("[data-path]").forEach((row) => observer.observe(row));
    return () => observer.disconnect();
  }, [shown]);
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
              In {collectionPicker ?? <strong>{backend.collectionName}</strong>}
              {sources !== null && sources > 0 && <> · {sources} {sources === 1 ? "source" : "sources"} to cite from mdbase Reader</>}
            </p>
          </div>
          {manuscripts && manuscripts.length > 0 && newButton}
        </header>
        {backgroundProblem && <p className="muted" role="alert">{backgroundProblem} <button type="button" onClick={() => void backend.reconcile?.().then(() => { setBackgroundProblem(null); setReload((v) => v + 1); })}>Retry background data</button></p>}
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
                    : <>None yet. {readerSourceHref() ? <a href={readerSourceHref()} target="_blank" rel="noopener">Open mdbase Reader</a> : "Open mdbase Reader"} to import a PDF, a DOI or a BibTeX file; each source gets a citekey.</>}
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
          <ul className="manuscripts" ref={rows}>
            {shown.map((m) => (
              <li key={m.path}>
                <button type="button" className="manuscript-row" data-path={m.path} onClick={() => onOpen(m.path)} title={m.path}>
                  <span className="manuscript-title">{m.title}</span>
                  <span className="manuscript-meta">
                    {[
                      m.template ? templateName(m.template) : null,
                      m.style ? styleName(m.style) : null,
                      (summaries.get(m.path)?.embeds ?? m.embeds) ? `${summaries.get(m.path)?.embeds ?? m.embeds} chapters` : null,
                      wordsLabel(summaries.get(m.path)?.words ?? m.words),
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
        {problem && !dialog && <div role="alert"><p className="problem">{problem}</p><button type="button" className="mdbase-button" onClick={() => { bodyCache.current.clear(); setReload((value) => value + 1); }}>Retry loading</button></div>}
      </section>

      <NewManuscriptDialog backend={backend} open={dialog} onClose={() => setDialog(false)} onOpen={onOpen} candidates={candidates} />
    </main>
  );
}

/** Keep form updates local: typing must not rerender the collection behind the dialog. */
function NewManuscriptDialog({ backend, open, onClose, onOpen, candidates }: {
  backend: WriterBackend;
  open: boolean;
  onClose(): void;
  onOpen(path: string): void;
  candidates: readonly string[];
}) {
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<TemplateName>("article");
  const [style, setStyle] = useState<StyleId>("chicago-notes-bibliography");
  const [creating, setCreating] = useState(false);
  const [starter, setStarter] = useState(false);
  const [notePath, setNotePath] = useState("");
  const [adopting, setAdopting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [untitled, setUntitled] = useState(false);
  const [adoptOpen, setAdoptOpen] = useState(false);
  const titleField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) titleField.current?.focus();
  }, [open]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creating || adopting) return;
    if (!title.trim()) {
      setUntitled(true);
      titleField.current?.focus();
      return;
    }
    setCreating(true);
    setProblem(null);
    try {
      const created = await backend.createManuscript({ title: title.trim(), template, style, starter });
      if (created.ok) onOpen(created.value);
      else setProblem(created.message);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not create the manuscript. Please try again.");
    } finally {
      setCreating(false);
    }
  };

  const adopt = async (event: React.FormEvent) => {
    event.preventDefault();
    const path = notePath.trim();
    if (!path || creating || adopting) return;
    setAdopting(true);
    setProblem(null);
    try {
      const adopted = await backend.adoptManuscript(path);
      if (adopted.ok) onOpen(adopted.value);
      else setProblem(adopted.message);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not use the note as a manuscript. Please try again.");
    } finally {
      setAdopting(false);
    }
  };

  return (
      <Dialog
        open={open}
        onClose={() => {
          onClose();
          setAdoptOpen(false);
          setUntitled(false);
          setProblem(null);
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
            <Select aria-label="Layout" value={template} options={TEMPLATE_OPTIONS} onChange={setTemplate} />
          </label>
          <label>
            Citation style
            <Select aria-label="Citation style" value={style} options={STYLE_OPTIONS} onChange={setStyle} />
          </label>
          <label className="span-2 starter-option"><input type="checkbox" checked={starter} onChange={(event) => setStarter(event.target.checked)} /> Include a worked example of citations, figures and chapters</label>
          <button className="mdbase-button is-primary" type="submit" disabled={creating || adopting}>
            {creating ? "Creating…" : "Create manuscript"}
          </button>
        </form>
        {adoptOpen ? (
          <>
            <div className="or-divider" role="separator"><span>or use a note you already have</span></div>
            <form className="adopt-note" onSubmit={(e) => void adopt(e)}>
              <NotePicker notes={candidates} value={notePath} onChange={setNotePath} />
              <button className="mdbase-button" type="submit" disabled={creating || adopting || !candidates.includes(notePath)}>
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
  );
}

const wordsLabel = (words: number | undefined) => (words === undefined ? null : `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`);

/**
 * Words in the records a body embeds on lines of their own, and in the
 * records those embed; `seen` keeps a record that embeds itself from counting twice.
 */
async function chapterWords(read: (path: string) => Promise<Result<string>>, from: string, targets: readonly string[], candidates: ReadonlySet<string>, seen: Set<string>): Promise<number> {
  let total = 0;
  for (const target of targets) {
    const path = resolveLinkTarget(target, from, candidates);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const body = await read(path);
    if (!body.ok) continue;
    const nested = chapterEmbeds(body.value).map((embed) => embed.target);
    total += wordCount(body.value) + await chapterWords(read, path, nested, candidates, seen);
  }
  return total;
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
