// The manuscript's settings: its frontmatter, edited as fields. Each field
// keeps its own draft while focused and commits after a pause or on blur, so
// typing never writes a half-parsed value per keystroke, and a change made
// elsewhere (another app, "Use theirs") shows up in every field not being
// edited. Problems with a setting appear under its field.
import type { JsonObject } from "@mdbase-dev/connect";
import { LOCALES, STYLES } from "@mdbase-writer/core/styles";
import { TEMPLATES, type MetaField } from "@mdbase-writer/core/meta";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { WriterDiagnostic } from "../compile/protocol.js";
import type { ManuscriptWorkspace, RecordView } from "../workspace/workspace.js";

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
  onToggle,
  focus,
}: {
  workspace: ManuscriptWorkspace;
  view: RecordView | undefined;
  filePaths: readonly string[];
  problems: readonly WriterDiagnostic[];
  open: boolean;
  onToggle(open: boolean): void;
  focus: SettingsFocus | null;
}) {
  if (!view) return null;
  const fm = view.snapshot.frontmatter;
  const patch = (p: JsonObject) => workspace.patchFrontmatter(workspace.main, p);
  const str = (k: string) => (typeof fm[k] === "string" ? (fm[k] as string) : typeof fm[k] === "number" ? String(fm[k]) : "");
  const problemsFor = (field: MetaField) => problems.filter((d) => d.field === field);
  const props = (field: MetaField) => ({ field, problems: problemsFor(field), focus });
  const cslFiles = filePaths.filter((p) => /\.csl$/i.test(p)).sort();
  const typFiles = filePaths.filter((p) => /\.typ$/i.test(p)).sort();
  const style = str("csl") || "chicago-notes-bibliography";
  const template = str("template") || "article";
  const settingProblems = problems.filter((d) => d.field).length;
  // Pandoc writes `author`, the manuscript type `authors`: edit the one the record has.
  const authorsKey = !("authors" in fm) && "author" in fm ? "author" : "authors";

  return (
    <details className="settings" open={open} onToggle={(e) => onToggle((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        Manuscript settings {settingProblems > 0 && <span className="count" title={`${settingProblems} problems`}>{settingProblems}</span>}
      </summary>
      <TextField label="Title" value={str("title")} onCommit={(v) => patch({ title: v })} {...props("title")} />
      <TextField label="Subtitle" value={str("subtitle")} onCommit={(v) => patch({ subtitle: v || null })} {...props("subtitle")} />
      <TextField
        label="Authors"
        hint="one per line; “Name; Affiliation”"
        multiline={2}
        value={authorsText(fm["authors"] ?? fm["author"])}
        onCommit={(v) => patch({ [authorsKey]: parseAuthors(v) })}
        {...props("authors")}
      />
      <TextField label="Date" value={str("date")} onCommit={(v) => patch({ date: v || null })} {...props("date")} />
      <TextField label="Abstract" multiline={4} value={str("abstract")} onCommit={(v) => patch({ abstract: v || null })} {...props("abstract")} />
      <SelectField label="Citation style" value={style} onCommit={(v) => patch({ csl: v })} {...props("csl")}>
        {STYLES.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
        <FileOptions label="From the collection" files={cslFiles} current={style} bundled={STYLES.map((s) => s.id)} />
      </SelectField>
      <SelectField label="Layout" value={template} onCommit={(v) => patch({ template: v })} {...props("template")}>
        {TEMPLATES.map((t) => <option key={t} value={t}>{t === "article" ? "Article" : "Thesis or book"}</option>)}
        <FileOptions label="Typst templates in the collection" files={typFiles} current={template} bundled={TEMPLATES} />
      </SelectField>
      <TextField
        label="Language"
        hint="for citation terms and hyphenation"
        placeholder="The style’s own (usually en-US)"
        list={LOCALES.map((l) => [l, LANGUAGE_NAMES[l] ?? l])}
        value={str("lang")}
        onCommit={(v) => patch({ lang: v.trim() || null })}
        {...props("lang")}
      />
    </details>
  );
}

function FileOptions({ label, files, current, bundled }: { label: string; files: readonly string[]; current: string; bundled: readonly string[] }) {
  // A value naming a file the index does not list (yet) still shows as chosen.
  const all = !bundled.includes(current) && !files.includes(current) ? [current, ...files] : files;
  if (!all.length) return null;
  return (
    <optgroup label={label}>
      {all.map((f) => <option key={f} value={f}>{f}</option>)}
    </optgroup>
  );
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
  useEffect(() => () => clearTimeout(timer.current), []);

  const commit = (next: string) => {
    clearTimeout(timer.current);
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
      {multiline ? <textarea rows={multiline} {...common} /> : <input {...common} list={list ? listId : undefined} />}
      {list && (
        <datalist id={listId}>
          {list.map(([v, name]) => <option key={v} value={v}>{name}</option>)}
        </datalist>
      )}
    </FieldFrame>
  );
}

function SelectField(props: FieldProps & { value: string; onCommit(value: string): void; children: ReactNode }) {
  const { value, onCommit, field, problems, focus, children } = props;
  const element = useRef<HTMLSelectElement>(null);
  const problemId = useId();
  useFocusRequest(field, focus, element);
  return (
    <FieldFrame {...props} id={problemId}>
      <select ref={element} value={value} aria-invalid={problems.length > 0 || undefined} aria-describedby={problems.length ? problemId : undefined} onChange={(e) => onCommit(e.target.value)}>
        {children}
      </select>
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
