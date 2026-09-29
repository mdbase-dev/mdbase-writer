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
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { WriterDiagnostic } from "../compile/protocol.js";
import type { ManuscriptWorkspace, RecordView } from "../workspace/workspace.js";
import { CloseIcon } from "./icons.js";
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
}: {
  workspace: ManuscriptWorkspace;
  view: RecordView | undefined;
  filePaths: readonly string[];
  problems: readonly WriterDiagnostic[];
  open: boolean;
  onClose(): void;
  focus: SettingsFocus | null;
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
  const props = (field: MetaField) => ({ field, problems: problemsFor(field), focus });
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
      <div className="settings">
        <div className="span-2">
          <TextField label="Title" value={str("title")} onCommit={(v) => patch({ title: v })} {...props("title")} />
        </div>
        <div className="span-2">
          <TextField label="Subtitle" value={str("subtitle")} onCommit={(v) => patch({ subtitle: v || null })} {...props("subtitle")} />
        </div>
        <TextField
          label="Authors"
          hint="one per line; “Name; Affiliation”"
          multiline={3}
          value={authorsText(fm["authors"] ?? fm["author"])}
          onCommit={(v) => patch({ [authorsKey]: parseAuthors(v) })}
          {...props("authors")}
        />
        <TextField label="Date" hint="as it should appear" value={str("date")} onCommit={(v) => patch({ date: v || null })} {...props("date")} />
        <div className="span-2">
          <TextField label="Abstract" multiline={7} value={str("abstract")} onCommit={(v) => patch({ abstract: v || null })} {...props("abstract")} />
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
      </div>
      <p className="muted small dialog-note">Changes are saved to the manuscript’s frontmatter as you type, and the preview follows them.</p>
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

function TextField(props: FieldProps & { value: string; onCommit(value: string): void; multiline?: number; placeholder?: string; list?: readonly (readonly [string, string])[] }) {
  const { value, onCommit, multiline, placeholder, list, field, problems, focus } = props;
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const element = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const problemId = useId();
  const listId = useId();
  useFocusRequest(field, focus, element);

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
      const next = e.target.value;
      setDraft(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => commit(next), COMMIT_AFTER_MS);
    },
  };
  return (
    <FieldFrame {...props} id={problemId}>
      {multiline ? <textarea className="mdbase-field" rows={multiline} {...common} /> : <input className="mdbase-field" {...common} list={list ? listId : undefined} />}
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

function authorsText(raw: JsonValue | undefined): string {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list
    .map((a) => (typeof a === "string" ? a : a && typeof a === "object" && !Array.isArray(a) ? [String(a["name"] ?? ""), a["affiliation"]].filter(Boolean).join("; ") : ""))
    .filter(Boolean)
    .join("\n");
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
