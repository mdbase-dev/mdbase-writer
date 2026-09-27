// Assembles a manuscript — a main record plus the records it embeds — into a
// Typst project.
//
// Records are translated independently and cached by body. Assembly is
// global: it decides which @-keys are cross-references and which are
// citations, runs citeproc over every cluster in document order (so ibid,
// disambiguation and note numbers are right across chapters), resolves
// embeds and images against the collection, substitutes placeholders and
// shifts source maps to match.
import type { CiteItem } from "./cite-items.js";
import { Citeproc, type Bibliography, type CitationRequest, type CiteprocMode, type CslItem } from "./citeproc.js";
import { typstLabel, typstString } from "./escape.js";
import { IMAGE_EXTENSION, resolveLinkTarget, type Frontmatter, type WriterRecord } from "./records.js";
import { HEADER, PLACEHOLDER, translateInline, translateRecord, type Diagnostic, type TranslatedRecord } from "./translate.js";

export const MAIN = "/__main__.typ";
export const TEMPLATES = ["article", "thesis"] as const;
export type TemplateName = (typeof TEMPLATES)[number];
export const DEFAULT_STYLE = "chicago-notes-bibliography";

/** Collection path of a record → path of its generated Typst file. */
export const typstPathFor = (recordPath: string) => `/${recordPath.replace(/\.md$/i, "")}.typ`;

export interface SourceMap {
  readonly record: string;
  /** Flat pairs [typstOffset, bodyOffset, …]. */
  readonly anchors: readonly number[];
}

export interface AssemblyDiagnostic extends Diagnostic {
  readonly record: string;
}

export interface ManuscriptMeta {
  readonly title?: string;
  readonly subtitle?: string;
  readonly authors: readonly { name: string; affiliation?: string }[];
  readonly abstract?: string;
  readonly date?: string;
  readonly style: string;
  readonly template: TemplateName;
}

export interface AssemblyInput {
  readonly main: string;
  /** Records loaded so far, by collection path. */
  readonly records: ReadonlyMap<string, WriterRecord>;
  /** Every Markdown record path in the collection (for resolving embeds). */
  readonly recordPaths: ReadonlySet<string>;
  /** Every non-record file path in the collection (for resolving images). */
  readonly filePaths: ReadonlySet<string>;
  readonly library: ReadonlyMap<string, CslItem>;
  readonly styles: ReadonlyMap<string, string>;
  readonly locale: string;
}

export interface Assembly {
  readonly meta: ManuscriptMeta;
  /** Typst path → source. */
  readonly sources: ReadonlyMap<string, string>;
  readonly maps: ReadonlyMap<string, SourceMap>;
  /** Records in include order (main first). */
  readonly order: readonly string[];
  /** Embedded records that exist in the collection but are not loaded yet. */
  readonly unloaded: readonly string[];
  /** Collection files the document uses (images). */
  readonly assets: readonly string[];
  /** Raw Typst blocks per Typst path, as [from, to, record, bodyFrom] after substitution. */
  readonly rawBlocks: ReadonlyMap<string, readonly (readonly [number, number, number])[]>;
  readonly diagnostics: readonly AssemblyDiagnostic[];
  readonly labels: ReadonlySet<string>;
  readonly citations: { readonly mode: CiteprocMode; readonly ms: number; readonly clusters: number };
  /** Rendered clusters in document order and bibliography entries (for tests). */
  readonly debug: { readonly citations: readonly string[]; readonly bibliography: readonly { key: string; text: string }[] };
}

type Plan =
  | { kind: "text"; text: string }
  | {
      kind: "cite";
      request: number;
      narrative?: CiteItem;
      first?: boolean;
      footnote: boolean;
      inNote: boolean;
      bracketed: boolean;
    };

interface Rendered {
  text: string;
  /** A generated note: moves after following punctuation (Pandoc's notes-after-punctuation). */
  note?: boolean;
}

export function manuscriptMeta(frontmatter: Frontmatter, styles: ReadonlyMap<string, string>): { meta: ManuscriptMeta; problems: string[] } {
  const problems: string[] = [];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : undefined);
  const rawAuthors = frontmatter["authors"] ?? frontmatter["author"];
  const authors = (Array.isArray(rawAuthors) ? rawAuthors : rawAuthors ? [rawAuthors] : []).flatMap((a): { name: string; affiliation?: string }[] => {
    if (typeof a === "string") return [{ name: a }];
    if (a && typeof a === "object" && typeof (a as Record<string, unknown>)["name"] === "string") {
      const o = a as Record<string, unknown>;
      const affiliation = str(o["affiliation"]);
      return [{ name: String(o["name"]), ...(affiliation ? { affiliation } : {}) }];
    }
    return [];
  });
  let style = str(frontmatter["csl"]) ?? str(frontmatter["citation_style"]) ?? DEFAULT_STYLE;
  if (!styles.has(style)) {
    problems.push(`Unknown citation style "${style}"; using ${DEFAULT_STYLE}.`);
    style = DEFAULT_STYLE;
  }
  let template = (str(frontmatter["template"]) ?? "article") as TemplateName;
  if (!TEMPLATES.includes(template)) {
    problems.push(`Unknown template "${template}"; using article.`);
    template = "article";
  }
  const title = str(frontmatter["title"]);
  const subtitle = str(frontmatter["subtitle"]);
  const abstract = str(frontmatter["abstract"]);
  const date = frontmatter["date"] instanceof Date ? frontmatter["date"].toISOString().slice(0, 10) : str(frontmatter["date"]);
  return {
    meta: {
      authors,
      style,
      template,
      ...(title ? { title } : {}),
      ...(subtitle ? { subtitle } : {}),
      ...(abstract ? { abstract } : {}),
      ...(date ? { date } : {}),
    },
    problems,
  };
}

export class ManuscriptAssembler {
  private readonly translations = new Map<string, { body: string; tr: TranslatedRecord }>();
  private readonly engines = new Map<string, Citeproc>();
  private engineLibrary?: ReadonlyMap<string, CslItem>;

  private translate(record: WriterRecord): TranslatedRecord {
    const cached = this.translations.get(record.path);
    if (cached && cached.body === record.body) return cached.tr;
    const tr = translateRecord(record.body);
    this.translations.set(record.path, { body: record.body, tr });
    return tr;
  }

  private engine(input: AssemblyInput, style: string): Citeproc {
    if (this.engineLibrary !== input.library) {
      this.engines.clear();
      this.engineLibrary = input.library;
    }
    let engine = this.engines.get(style);
    if (!engine) {
      engine = new Citeproc(input.styles.get(style) ?? "", input.locale, input.library);
      this.engines.set(style, engine);
    }
    return engine;
  }

  assemble(input: AssemblyInput): Assembly {
    const diagnostics: AssemblyDiagnostic[] = [];
    const mainRecord = input.records.get(input.main);
    const { meta, problems } = manuscriptMeta(mainRecord?.frontmatter ?? {}, input.styles);
    for (const message of problems) diagnostics.push({ record: input.main, from: 0, to: 0, severity: "warning", message });

    // Include order, depth-first as Typst evaluates it.
    const order: string[] = [];
    const unloaded: string[] = [];
    const includeTargets = new Map<string, (string | null)[]>();
    const visit = (path: string, stack: readonly string[]) => {
      const record = input.records.get(path);
      if (!record) {
        if (!unloaded.includes(path)) unloaded.push(path);
        return;
      }
      if (order.includes(path)) return;
      order.push(path);
      const tr = this.translate(record);
      const targets = tr.includes.map((inc) => {
        const resolved = resolveLinkTarget(inc.target, path, input.recordPaths);
        if (!resolved) {
          diagnostics.push({ record: path, from: inc.from, to: inc.to, severity: "error", message: `No record matches the embed ![[${inc.target}]].` });
          return null;
        }
        if (resolved === path || stack.includes(resolved)) {
          diagnostics.push({ record: path, from: inc.from, to: inc.to, severity: "error", message: `Embedding ${resolved} here would include it inside itself.` });
          return null;
        }
        return resolved;
      });
      includeTargets.set(path, targets);
      for (const t of targets) if (t) visit(t, [...stack, path]);
    };
    visit(input.main, []);

    const translated = new Map(order.map((p) => [p, this.translate(input.records.get(p) as WriterRecord)]));
    for (const [path, tr] of translated) for (const d of tr.diagnostics) diagnostics.push({ record: path, ...d });
    const labels = new Set<string>();
    for (const [path, tr] of translated) {
      for (const label of tr.labels) {
        if (labels.has(label)) diagnostics.push({ record: path, from: 0, to: 0, severity: "warning", message: `The label ${label} is used more than once.` });
        labels.add(label);
      }
    }

    // Citations: walk every record's events in document order.
    const cp = this.engine(input, meta.style);
    const plans = new Map<string, Plan[]>();
    const requests: CitationRequest[] = [];
    let note = 0;
    let inFootnote: number | null = null;
    const seen = new Set<string>();
    for (const path of order) {
      const tr = translated.get(path) as TranslatedRecord;
      const plan: Plan[] = [];
      plans.set(path, plan);
      for (const ev of tr.events) {
        if (ev.t === "fn-open") {
          note++;
          inFootnote = note;
          continue;
        }
        if (ev.t === "fn-close") {
          inFootnote = null;
          continue;
        }
        const cl = tr.clusters[ev.index];
        if (!cl) continue;
        const refs = cl.items.filter((i) => labels.has(i.key));
        if (refs.length && refs.length === cl.items.length) {
          plan[ev.index] = {
            kind: "text",
            text: cl.items
              .map((i) => `${i.prefix ? `${looseEscape(i.prefix)} ` : ""}#ref(<${typstLabel(i.key)}>);${i.suffix ? looseEscape(i.suffix) : ""}`)
              .join(", "),
          };
          continue;
        }
        for (const m of cl.items.filter((i) => !labels.has(i.key) && !cp.has(i.key))) {
          const looksLikeXref = /^(sec|fig|tbl|eq|lst|thm|lem|def)-/.test(m.key);
          diagnostics.push({
            record: path,
            from: cl.from,
            to: cl.to,
            severity: "error",
            message: looksLikeXref ? `Nothing is labelled ${m.key}.` : `No source in the library has the citekey ${m.key}.`,
          });
        }
        const items = cl.items.filter((i) => cp.has(i.key));
        if (!items.length || refs.length) {
          if (refs.length && items.length) {
            diagnostics.push({ record: path, from: cl.from, to: cl.to, severity: "error", message: "A citation cannot mix cross-references and citekeys." });
          }
          plan[ev.index] = { kind: "text", text: cl.items.map((i) => `#missing(${typstString(i.key)});`).join(", ") };
          continue;
        }
        const inNote = inFootnote !== null;
        const footnote = cp.isNoteStyle && !inNote;
        if (footnote) note++;
        // Narrative @key: the author in the text, the rest with the author
        // suppressed. Inside a footnote of a note style Pandoc renders the full
        // citation inline instead.
        const narrative = !cl.bracketed && !(cp.isNoteStyle && inNote) ? items[0] : undefined;
        const first = narrative ? !seen.has(narrative.key) : undefined;
        for (const i of items) seen.add(i.key);
        requests.push({
          items: narrative ? [{ ...narrative, suppressAuthor: true }] : items,
          noteIndex: cp.isNoteStyle ? (inFootnote ?? note) : (inFootnote ?? 0),
        });
        plan[ev.index] = {
          kind: "cite",
          request: requests.length - 1,
          footnote,
          inNote: cp.isNoteStyle && inNote,
          bracketed: cl.bracketed,
          ...(narrative ? { narrative } : {}),
          ...(first !== undefined ? { first } : {}),
        };
      }
    }
    const result = cp.process(requests);

    const render = (p: Plan | undefined): Rendered => {
      if (!p) return { text: "" };
      if (p.kind === "text") return { text: p.text };
      let s = result.strings[p.request] ?? "";
      // Inside a note the surrounding sentence supplies punctuation.
      if (p.inNote) s = s.replace(/\.$/, "");
      if (p.narrative) {
        const author = cp.authorOnly(p.narrative.key, p.first ?? false);
        if (cp.isNoteStyle) return { text: `${author}#footnote[${s}];` };
        return { text: author ? `${author} ${s}` : s };
      }
      if (p.inNote && p.bracketed) return { text: `(${s})` };
      if (p.footnote) return { text: `#footnote[${s.replace(/^[a-z]/, (c) => c.toUpperCase())}];`, note: true };
      return { text: s };
    };

    // Images: resolve against the collection's files.
    const assets = new Set<string>();
    const imageExpression = (path: string, index: number): string => {
      const ref = (translated.get(path) as TranslatedRecord).images[index];
      if (!ref) return "none";
      const remote = /^[a-z]+:\/\//i.test(ref.target);
      const resolved = remote ? null : resolveLinkTarget(ref.target, path, input.filePaths, "");
      if (!resolved || !IMAGE_EXTENSION.test(resolved)) {
        diagnostics.push({
          record: path,
          from: ref.from,
          to: ref.to,
          severity: "error",
          message: remote ? `Images must be files in the collection (${ref.target}).` : `No file in the collection matches the image ${ref.target}.`,
        });
        return `missing-image(${typstString(ref.target)})`;
      }
      assets.add(resolved);
      return `image(${typstString(`/${resolved}`)}${ref.width ? `, width: ${ref.width}` : ""})`;
    };

    const sources = new Map<string, string>();
    const maps = new Map<string, SourceMap>();
    const rawBlocks = new Map<string, (readonly [number, number, number])[]>();
    const debugCitations: string[] = [];
    for (const path of order) {
      const tr = translated.get(path) as TranslatedRecord;
      const plan = plans.get(path) ?? [];
      for (const p of plan) if (p?.kind === "cite") debugCitations.push(render(p).text);
      const targets = includeTargets.get(path) ?? [];
      const substituted = substitute(tr, {
        cluster: (i) => render(plan[i]),
        image: (i) => imageExpression(path, i),
        include: (i) => {
          const t = targets[i];
          return t ? `#include ${typstString(typstPathFor(t))}` : "";
        },
      });
      const bound = bindRecordPath(substituted, path);
      sources.set(typstPathFor(path), bound.text);
      maps.set(typstPathFor(path), { record: path, anchors: bound.anchors });
      rawBlocks.set(
        typstPathFor(path),
        tr.rawBlocks.map((b) => [bound.shift(b.typstFrom), bound.shift(b.typstTo), b.from] as const),
      );
    }
    sources.set(MAIN, mainSource(input.main, meta, result.bibliography));

    return {
      meta,
      sources,
      maps,
      order,
      unloaded,
      assets: [...assets],
      rawBlocks,
      diagnostics,
      labels,
      citations: { mode: result.mode, ms: result.ms, clusters: requests.length },
      debug: {
        citations: debugCitations,
        bibliography: result.bibliography.entries.map((e) => ({ key: e.key, text: (e.label ? `${e.label} ` : "") + e.body })),
      },
    };
  }
}

function looseEscape(s: string): string {
  return s.replace(/[\\#*_`$@<>[\]~]/g, "\\$&");
}

function mainSource(mainPath: string, meta: ManuscriptMeta, bib: Bibliography): string {
  const authors = meta.authors
    .map((a) => `(name: [${translateInline(a.name)}]${a.affiliation ? `, affiliation: [${translateInline(a.affiliation)}]` : ""})`)
    .join(", ");
  const lines = [
    HEADER.trimEnd(),
    `#import "/templates/${meta.template}.typ": *`,
    `#show: ${meta.template}.with(`,
    meta.title ? `  title: [${translateInline(meta.title)}],` : "",
    meta.subtitle ? `  subtitle: [${translateInline(meta.subtitle)}],` : "",
    `  authors: (${authors}${meta.authors.length === 1 ? "," : ""}),`,
    meta.abstract ? `  abstract: [${translateInline(meta.abstract)}],` : "",
    meta.date ? `  date: ${typstString(meta.date)},` : "",
    `)`,
    `#include ${typstString(typstPathFor(mainPath))}`,
  ];
  if (bib.entries.length) {
    const entries = bib.entries.map((e) => {
      const anchor = `#metadata(none)<ref-${typstLabel(e.key)}>`;
      return bib.secondFieldAlign && e.label !== undefined ? `([${anchor}${e.label}], [${e.body}])` : `[${anchor}${e.body}]`;
    });
    lines.push(`#bibliography-list(hanging: ${bib.hangingIndent}, (\n${entries.join(",\n")},\n))`);
  }
  // One query target listing every block marker's page position (preview click → source).
  lines.push(`#context [#metadata(query(<md-src>).map(m => (m.value, m.location().position()))) <md-pos>]`);
  return `${lines.filter(Boolean).join("\n")}\n`;
}

interface Substitutions {
  cluster(index: number): Rendered;
  image(index: number): string;
  include(index: number): string;
}

const PLACEHOLDERS = new RegExp(
  `(${PLACEHOLDER.cluster[0]}|${PLACEHOLDER.image[0]}|${PLACEHOLDER.include[0]})(\\d+)[${PLACEHOLDER.cluster[1]}${PLACEHOLDER.image[1]}${PLACEHOLDER.include[1]}]`,
  "g",
);

/** Replaces placeholders; returns the text and a function mapping old offsets to new ones. */
function substitute(tr: TranslatedRecord, subs: Substitutions): { text: string; anchors: number[]; shift: (offset: number) => number } {
  const src = tr.typst;
  const parts: string[] = [];
  const shifts: [number, number][] = []; // [old offset, cumulative delta from there on]
  let last = 0;
  let delta = 0;
  PLACEHOLDERS.lastIndex = 0;
  for (let m = PLACEHOLDERS.exec(src); m; m = PLACEHOLDERS.exec(src)) {
    let before = src.slice(last, m.index);
    const index = Number(m[2]);
    let end = m.index + m[0].length;
    let text: string;
    if (m[1] === PLACEHOLDER.cluster[0]) {
      const r = subs.cluster(index);
      text = r.text;
      if (r.note) {
        const trimmed = before.replace(/[ \t]+$/, "");
        delta -= before.length - trimmed.length;
        before = trimmed;
        const punct = /^[.,;:!?]+/.exec(src.slice(end));
        if (punct) {
          text = punct[0] + text;
          end += punct[0].length;
          delta -= punct[0].length;
        }
      }
    } else if (m[1] === PLACEHOLDER.image[0]) text = subs.image(index);
    else text = subs.include(index);
    parts.push(before, text);
    delta += text.length - m[0].length;
    shifts.push([end, delta]);
    last = end;
    PLACEHOLDERS.lastIndex = end;
  }
  parts.push(src.slice(last));
  const shift = (offset: number) => {
    let d = 0;
    for (const [at, value] of shifts) {
      if (at <= offset) d = value;
      else break;
    }
    return offset + d;
  };
  const anchors = [...tr.anchors];
  for (let i = 0; i < anchors.length; i += 2) anchors[i] = shift(anchors[i] ?? 0);
  return { text: parts.join(""), anchors, shift };
}

/** Binds `md-file` (used by source markers) right after the import header. */
function bindRecordPath(r: { text: string; anchors: number[]; shift: (o: number) => number }, record: string) {
  const line = `#let md-file = ${typstString(record)}\n`;
  const at = HEADER.length;
  const anchors = r.anchors.map((v, i) => (i % 2 === 0 && v >= at ? v + line.length : v));
  const shift = (o: number) => {
    const s = r.shift(o);
    return s >= at ? s + line.length : s;
  };
  return { text: r.text.slice(0, at) + line + r.text.slice(at), anchors, shift };
}

/** Maps an offset in a generated Typst file back to a body offset in its record. */
export function mapToRecord(map: SourceMap, typstOffset: number): number {
  const a = map.anchors;
  let lo = 0;
  let hi = a.length / 2 - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((a[mid * 2] ?? 0) <= typstOffset) {
      best = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (best < 0) return 0;
  const start = a[best * 2] ?? 0;
  const src = a[best * 2 + 1] ?? 0;
  const nextSrc = best * 2 + 3 < a.length ? (a[best * 2 + 3] ?? Infinity) : Infinity;
  // Escaping makes Typst runs slightly longer; never run past the next anchor.
  return Math.min(src + (typstOffset - start), Math.max(src, nextSrc - 1));
}

/** Converts a Typst "line:col" diagnostic position to an offset in the source. */
export function typstPositionToOffset(source: string, line: number, column: number): number {
  let offset = 0;
  let current = 1;
  for (let i = 0; i < source.length && current < line; i++) {
    if (source[i] === "\n") current++;
    offset = i + 1;
  }
  return offset + Math.max(0, column - 1);
}
