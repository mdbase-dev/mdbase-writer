// The manuscript's settings: its frontmatter, edited as fields in a sheet beside
// the preview, so a new style or layout shows as it is chosen. Each field
// keeps its own draft while focused and commits after a pause or on blur, so
// typing never writes a half-parsed value per keystroke, and a change made
// elsewhere (another app, "Use theirs") shows up in every field not being
// edited. Problems with a setting appear under its field.
import type { JsonObject } from "@mdbase-dev/connect";
import { Select, type SelectItems } from "@mdbase-dev/ui/select";
import { LOCALES, STYLES } from "@mdbase-writer/core/styles";
import { TEMPLATES, type MetaField } from "@mdbase-writer/core/meta";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import type { WriterDiagnostic } from "../compile/protocol.js";
import type { ManuscriptWorkspace, RecordView } from "../workspace/workspace.js";
import { joinSoftBreaks } from "../editor/join-lines.js";
import { ChevronUp, CloseIcon, MinusIcon, PlusIcon } from "./icons.js";
import { templateName } from "./names.js";

type JsonValue = JsonObject[string];

const COMMIT_AFTER_MS = 600;
const LANGUAGE_NAMES: Record<string, string> = {
  "en-US": "English (US)",
  "en-GB": "English (UK)",
  "de-DE": "German",
  "fr-FR": "French",
  "es-ES": "Spanish",
  "it-IT": "Italian",
  "nl-NL": "Dutch",
  "pt-BR": "Portuguese (Brazil)",
};

export interface SettingsFocus {
  readonly field: MetaField;
  /** Changes on every request, so asking for the same field again refocuses it. */
  readonly nonce: number;
}

export function Settings({
  workspace,
  view,
  filePaths,
  problems,
  open,
  onClose,
  focus,
  joinLines = false,
  livePreview = true,
  onJoinLines,
  onLivePreview,
}: {
  workspace: ManuscriptWorkspace;
  view: RecordView | undefined;
  filePaths: readonly string[];
  problems: readonly WriterDiagnostic[];
  open: boolean;
  onClose(): void;
  focus: SettingsFocus | null;
  /** Shows the abstract's soft line breaks as spaces, as the editor does. */
  joinLines?: boolean;
  livePreview?: boolean;
  onJoinLines?(): void;
  onLivePreview?(): void;
}) {
  const titleId = useId();
  const sheet = useRef<HTMLElement>(null);
  // Opening moves focus into the sheet (unless a field was asked for); closing returns it.
  useEffect(() => {
    if (!open) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!focus) sheet.current?.querySelector<HTMLElement>("input, textarea, button.mdbase-select")?.focus();
    return () => {
      // Only when focus was in the sheet, which has gone (it is on the body), or is still in it.
      const now = document.activeElement;
      if (before?.isConnected && (!now || now === document.body || sheet.current?.contains(now))) before.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only opening moves focus
  }, [open]);
  // Escape closes the sheet wherever focus is, unless something else (a choice list,
  // a menu, the editor's completions, a dialog) took it first.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!view || !open) return null;
  const fm = view.snapshot.frontmatter;
  const patch = (p: JsonObject) => workspace.patchFrontmatter(workspace.main, p);
  const str = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : typeof fm[k] === "number" ? String(fm[k]) : "");
  const problemsFor = (field: MetaField) => problems.filter((d) => d.field === field);
  const props = (field: MetaField) => ({ field, problems: problemsFor(field), focus,
    onDraft: (draft: string) => workspace.stageFrontmatter(workspace.main, field === "authors" ? { [authorsKey]: parseAuthors(draft) } : { [field]: field === "title" ? draft : field === "lang" ? draft.trim() || null : draft || null }),
  });
  const cslFiles = filePaths.filter((p) => /\.csl$/i.test(p)).sort();
  const typFiles = filePaths.filter((p) => /\.typ$/i.test(p)).sort();
  const style = str("csl") || "chicago-notes-bibliography";
  const template = str("template") || "article";
  // Pandoc writes `author`, the manuscript type `authors`: edit the one the record has.
  const authorsKey = !("authors" in fm) && "author" in fm ? "author" : "authors";

  return (
    <aside
      ref={sheet}
      className="settings-sheet"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
    >
      <header className="settings-sheet-header">
        <h2 id={titleId}>Manuscript settings</h2>
        <button type="button" className="mdbase-icon-button" onClick={onClose} aria-label="Close settings" title="Close (Escape)">
          <CloseIcon />
        </button>
      </header>
      <fieldset className="settings" disabled={view.snapshot.state === "deleted" || workspace.getSnapshot().recoveredDrafts.has(workspace.main)}>
        <div className="span-2">
          <TextField label="Title" multiline={1} grow singleLine value={str("title")} onCommit={(v) => patch({ title: v })} {...props("title")} />
        </div>
        <div className="span-2">
          <TextField label="Subtitle" multiline={1} grow singleLine value={str("subtitle")} onCommit={(v) => patch({ subtitle: v || null })} {...props("subtitle")} />
        </div>
        <div className="span-2">
          <AuthorsField
            label="Authors"
            value={authorList(fm["authors"] ?? fm["author"])}
            onCommit={(authors) => patch({ [authorsKey]: authors.length ? authors.map(toAuthor) : null })}
            {...props("authors")}
            onDraft={(draft) => workspace.stageFrontmatter(workspace.main, { [authorsKey]: parseAuthors(draft) })}
          />
        </div>
        <TextField label="Date" hint="as it should appear" value={str("date")} onCommit={(v) => patch({ date: v || null })} {...props("date")} />
        <div className="span-2">
          <TextField label="Abstract" multiline={7} grow value={joinLines ? joinSoftBreaks(str("abstract")) : str("abstract")} onCommit={(v) => patch({ abstract: v || null })} {...props("abstract")} />
        </div>
        <SelectField
          label="Citation style"
          value={style}
          onCommit={(v) => patch({ csl: v })}
          options={[
            ...STYLES.map((s) => ({ value: s.id as string, label: s.title })),
            ...fileOptions("From the collection", cslFiles, style, STYLES.map((s) => s.id)),
          ]}
          {...props("csl")}
        />
        <SelectField
          label="Layout"
          value={template}
          onCommit={(v) => patch({ template: v })}
          options={[
            ...TEMPLATES.map((t) => ({ value: t as string, label: templateName(t) })),
            ...fileOptions("Typst templates in the collection", typFiles, template, TEMPLATES),
          ]}
          {...props("template")}
        />
        <TextField
          label="Language"
          hint="for citation terms and hyphenation"
          placeholder="The style’s own (usually en-US)"
          list={LOCALES.map((l) => [l, LANGUAGE_NAMES[l] ?? l])}
          value={str("lang")}
          onCommit={(v) => patch({ lang: v.trim() || null })}
          {...props("lang")}
        />
      </fieldset>
      <p className="muted small dialog-note">Changes are saved to the manuscript’s frontmatter as you type, and the preview follows them.</p>
      {(onJoinLines || onLivePreview) && (
        <section className="editor-prefs" aria-labelledby={`${titleId}-editor`}>
          <h2 id={`${titleId}-editor`}>Editor</h2>
          {onLivePreview && (
            <label className="pref-row" title="Citations show who they cite, figures and tables are drawn, and marks are hidden until the cursor reaches their line. The text is not changed.">
              <input type="checkbox" checked={livePreview} onChange={onLivePreview} />
              <span>Read as the manuscript<span className="muted small">Off shows the Markdown as written</span></span>
            </label>
          )}
          {onJoinLines && (
            <label className="pref-row" title="A line break inside a paragraph reads as a space; show it as one, so hard-wrapped text flows to the editor's width. The text is not changed.">
              <input type="checkbox" checked={joinLines} onChange={onJoinLines} />
              <span>Join hard-wrapped lines<span className="muted small">Paragraphs flow to the editor’s width</span></span>
            </label>
          )}
          <p className="muted small dialog-note">These apply in this browser, to every manuscript.</p>
        </section>
      )}
    </aside>
  );
}

function fileOptions(label: string, files: readonly string[], current: string, bundled: readonly string[]): SelectItems {
  // A value naming a file the index does not list (yet) still shows as chosen.
  const all = !bundled.includes(current) && !files.includes(current) ? [current, ...files] : files;
  return all.length ? [{ label, options: all.map((f) => ({ value: f, label: f })) }] : [];
}

interface FieldProps {
  field: MetaField;
  label: string;
  hint?: string;
  problems: readonly WriterDiagnostic[];
  focus: SettingsFocus | null;
  onDraft?(value: string): void;
}

function FieldFrame({ label, hint, problems, children, id }: FieldProps & { children: ReactNode; id: string }) {
  return (
    <label className={problems.length ? "has-problem" : undefined}>
      <span>
        {label} {hint && <span className="muted small">{hint}</span>}
      </span>
      {children}
      {problems.map((p, i) => (
        <span key={i} id={i === 0 ? id : undefined} className={`field-problem severity-${p.severity}`}>
          {p.message}
        </span>
      ))}
    </label>
  );
}

/** Focuses the control when its field is asked for (from the Problems list). */
function useFocusRequest(field: MetaField, focus: SettingsFocus | null, element: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (focus?.field !== field) return;
    const el = element.current;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    el.focus({ preventScroll: true });
  }, [field, focus, element]);
}

function TextField(props: FieldProps & {
  value: string;
  onCommit(value: string): void;
  /** Rows of a text area (a text field without it); with `grow`, the fewest it shows. */
  multiline?: number;
  /** The text area grows with its text. */
  grow?: boolean;
  /** One line of text that wraps: Enter does not add a line break. */
  singleLine?: boolean;
  placeholder?: string;
  list?: readonly (readonly [string, string])[];
}) {
  const { value, onCommit, onDraft, multiline, grow, singleLine, placeholder, list, field, problems, focus } = props;
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const element = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const problemId = useId();
  const listId = useId();
  useFocusRequest(field, focus, element);
  useLayoutEffect(() => {
    const el = element.current;
    if (!grow || !el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [grow, draft]);

  // Follow the record while this field is not being edited.
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  // A draft still waiting to commit (the sheet closed mid-pause) is saved, not dropped.
  const pending = useRef<{ draft: string; value: string; onCommit(value: string): void }>({ draft, value, onCommit });
  pending.current = { draft, value, onCommit };
  useEffect(
    () => () => {
      if (timer.current === undefined) return;
      clearTimeout(timer.current);
      const { draft: last, value: saved, onCommit: save } = pending.current;
      if (last !== saved) save(last);
    },
    [],
  );

  const commit = (next: string) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (next !== value) onCommit(next);
  };
  const common = {
    ref: element,
    value: draft,
    placeholder,
    "aria-invalid": problems.length > 0 || undefined,
    "aria-describedby": problems.length ? problemId : undefined,
    onFocus: () => (editing.current = true),
    onBlur: () => {
      editing.current = false;
      commit(draft);
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = singleLine ? e.target.value.replace(/\s*\n\s*/g, " ") : e.target.value;
      setDraft(next);
      onDraft?.(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => commit(next), COMMIT_AFTER_MS);
    },
  };
  return (
    <FieldFrame {...props} id={problemId}>
      {multiline ? (
        <textarea
          className={`mdbase-field${grow ? " is-growing" : ""}`}
          rows={multiline}
          {...common}
          {...(singleLine ? { onKeyDown: (e: React.KeyboardEvent) => e.key === "Enter" && e.preventDefault() } : {})}
        />
      ) : <input className="mdbase-field" {...common} list={list ? listId : undefined} />}
      {list && (
        <datalist id={listId}>
          {list.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
        </datalist>
      )}
    </FieldFrame>
  );
}

function SelectField(props: FieldProps & { value: string; onCommit(value: string): void; options: SelectItems }) {
  const { value, onCommit, field, problems, focus, options, label } = props;
  const element = useRef<HTMLButtonElement>(null);
  const problemId = useId();
  useFocusRequest(field, focus, element);
  return (
    <FieldFrame {...props} id={problemId}>
      <Select ref={element} aria-label={label} value={value} options={options} aria-invalid={problems.length > 0 || undefined} aria-describedby={problems.length ? problemId : undefined} onChange={onCommit} />
    </FieldFrame>
  );
}

export interface Author {
  readonly name: string;
  readonly affiliation: string;
}

/** Authors as the record has them (strings or objects), as rows to edit. */
export function authorList(raw: JsonValue | undefined): Author[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((a): Author | null => {
      if (typeof a === "string") { const [name = "", ...rest] = a.split(";").map((p) => p.trim()); return { name, affiliation: rest.filter(Boolean).join("; ") }; }
      if (a && typeof a === "object" && !Array.isArray(a)) return { name: String(a["name"] ?? ""), affiliation: typeof a["affiliation"] === "string" ? a["affiliation"] : "" };
      return null;
    })
    .filter((a): a is Author => a !== null && (a.name !== "" || a.affiliation !== ""));
}

const toAuthor = (a: Author): JsonObject => (a.affiliation.trim() ? { name: a.name.trim(), affiliation: a.affiliation.trim() } : { name: a.name.trim() });
const authorsDraft = (authors: readonly Author[]) => authors.map((a) => [a.name, a.affiliation].filter((p) => p.trim()).join("; ")).join("\n");

/** Authors as rows of name and affiliation: add, remove or reorder them. */
function AuthorsField(props: FieldProps & { value: readonly Author[]; onCommit(authors: readonly Author[]): void }) {
  const { value, onCommit, onDraft, field, problems, focus, label } = props;
  const [rows, setRows] = useState<Author[]>(() => [...value]);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const element = useRef<HTMLDivElement>(null);
  const problemId = useId();
  useFocusRequest(field, focus, element);
  useEffect(() => {
    if (!editing.current) setRows([...value]);
  }, [value]);
  const same = (a: readonly Author[], b: readonly Author[]) => JSON.stringify(a.map(toAuthor)) === JSON.stringify(b.map(toAuthor));
  const commit = (next: readonly Author[]) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const kept = next.filter((a) => a.name.trim() || a.affiliation.trim());
    if (!same(kept, value)) onCommit(kept);
  };
  const pending = useRef({ rows, value, onCommit });
  pending.current = { rows, value, onCommit };
  useEffect(() => () => {
    if (timer.current === undefined) return;
    clearTimeout(timer.current);
    const { rows: last, value: saved, onCommit: save } = pending.current;
    const kept = last.filter((a) => a.name.trim() || a.affiliation.trim());
    if (!same(kept, saved)) save(kept);
  }, []);
  const change = (next: Author[], immediate = false) => {
    setRows(next);
    onDraft?.(authorsDraft(next));
    clearTimeout(timer.current);
    if (immediate) commit(next);
    else timer.current = setTimeout(() => commit(next), COMMIT_AFTER_MS);
  };
  const shown = rows.length ? rows : [{ name: "", affiliation: "" }];
  return (
    <div className={`authors-field${problems.length ? " has-problem" : ""}`} ref={element} role="group" aria-label={label} aria-describedby={problems.length ? problemId : undefined}>
      <span className="authors-label">{label}</span>
      {shown.map((author, i) => (
        <div key={i} className="author-row" onFocus={() => (editing.current = true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) { editing.current = false; commit(rows); } }}>
          <input className="mdbase-field" value={author.name} placeholder="Name" aria-label={`Author ${i + 1} name`} onChange={(e) => change(shown.map((a, j) => (j === i ? { ...a, name: e.target.value } : a)))} />
          <input className="mdbase-field" value={author.affiliation} placeholder="Affiliation" aria-label={`Author ${i + 1} affiliation`} onChange={(e) => change(shown.map((a, j) => (j === i ? { ...a, affiliation: e.target.value } : a)))} />
          <button type="button" className="mdbase-icon-button is-small" aria-label={`Move author ${i + 1} up`} title="Move up" disabled={i === 0} onClick={() => change(shown.map((a, j) => (j === i - 1 ? shown[i]! : j === i ? shown[i - 1]! : a)), true)}>
            <ChevronUp />
          </button>
          <button type="button" className="mdbase-icon-button is-small" aria-label={`Remove author ${i + 1}`} title="Remove" disabled={shown.length === 1 && !author.name && !author.affiliation} onClick={() => change(shown.filter((_, j) => j !== i), true)}>
            <MinusIcon />
          </button>
        </div>
      ))}
      <div className="author-actions">
        <button type="button" className="text-button" onClick={() => change([...shown, { name: "", affiliation: "" }])}>
          <PlusIcon />
          Add author
        </button>
      </div>
      {problems.map((p, i) => (
        <span key={i} id={i === 0 ? problemId : undefined} className={`field-problem severity-${p.severity}`}>{p.message}</span>
      ))}
    </div>
  );
}

export function parseAuthors(text: string): JsonObject[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name = "", ...rest] = l.split(";").map((s) => s.trim());
      const affiliation = rest.filter(Boolean).join("; ");
      return affiliation ? { name, affiliation } : { name };
    });
}
