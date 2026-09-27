// Citation formatting with citeproc-js, emitting Typst markup directly
// through a custom output format. Typst never sees CSL; it lays out the
// strings produced here, so PDF output and Pandoc/citeproc DOCX output agree.
//
// Processing is incremental: when a single cluster is inserted or changed,
// citeproc-js's processCitationCluster updates it (and any clusters whose
// position or disambiguation it affects) instead of re-running the document.
import CSL from "citeproc";

import type { CiteItem } from "./cite-items.js";
import { escapeMarkup, typstLabel, typstString, unescapeMarkup } from "./escape.js";

export type CslItem = { readonly id: string } & Readonly<Record<string, unknown>>;

const ENTRY_END = "";
const MARGIN_END = "";

interface CiteEntryContext {
  item_id?: string;
  locator_txt?: string;
  suffix_txt?: string;
}
interface CiteprocState {
  getTerm(term: string): string;
  sys: { wrapCitationEntry(str: string, id: string, locator?: string, suffix?: string): string };
}

const passthrough = CSL.Output.Formatters.passthrough;
// citeproc-js calls these with its own `this` and state; the shapes are its contract.
const typstFormat: Record<string, unknown> = {
  text_escape: (text: string) => escapeMarkup(text ?? ""),
  bibstart: "",
  bibend: "",
  "@font-style/italic": "#emph[%%STRING%%];",
  "@font-style/oblique": "#emph[%%STRING%%];",
  "@font-style/normal": false,
  "@font-variant/small-caps": "#smallcaps[%%STRING%%];",
  "@passthrough/true": passthrough,
  "@font-variant/normal": false,
  "@font-weight/bold": "#strong[%%STRING%%];",
  "@font-weight/normal": false,
  "@font-weight/light": false,
  "@text-decoration/none": false,
  "@text-decoration/underline": "#underline[%%STRING%%];",
  "@vertical-align/baseline": false,
  "@vertical-align/sup": "#super[%%STRING%%];",
  "@vertical-align/sub": "#sub[%%STRING%%];",
  "@strip-periods/true": passthrough,
  "@strip-periods/false": passthrough,
  "@quotes/true": function (state: CiteprocState, str?: string) {
    return str === undefined ? state.getTerm("open-quote") : state.getTerm("open-quote") + str + state.getTerm("close-quote");
  },
  "@quotes/inner": function (state: CiteprocState, str?: string) {
    return str === undefined ? "’" : state.getTerm("open-inner-quote") + str + state.getTerm("close-inner-quote");
  },
  "@quotes/false": false,
  "@cite/entry": function (this: CiteEntryContext, state: CiteprocState, str?: string) {
    return state.sys.wrapCitationEntry(str ?? "", this.item_id ?? "", this.locator_txt, this.suffix_txt);
  },
  "@bibliography/entry": (_state: CiteprocState, str?: string) => (str ?? "") + ENTRY_END,
  "@display/block": (_state: CiteprocState, str?: string) => ` \\ ${str ?? ""}`,
  "@display/left-margin": (_state: CiteprocState, str?: string) => (str ?? "") + MARGIN_END,
  "@display/right-inline": (_state: CiteprocState, str?: string) => str ?? "",
  "@display/indent": (_state: CiteprocState, str?: string) => str ?? "",
  "@showid/true": (_state: CiteprocState, str?: string) => str ?? "",
  "@URL/true": (_state: CiteprocState, str?: string) => `#link(${typstString(unescapeMarkup(str ?? ""))})[${str ?? ""}];`,
  "@DOI/true": (_state: CiteprocState, str?: string) => {
    const doi = unescapeMarkup(str ?? "");
    return `#link(${typstString(/^https?:/.test(doi) ? doi : `https://doi.org/${doi}`)})[${str ?? ""}];`;
  },
};
(CSL.Output.Formats as unknown as Record<string, unknown>)["typst"] = typstFormat;

export interface CitationRequest {
  readonly items: readonly CiteItem[];
  readonly noteIndex: number;
}

export interface BibliographyEntry {
  readonly key: string;
  /** Label column for numeric styles (second-field-align). */
  readonly label?: string;
  readonly body: string;
}

export interface Bibliography {
  readonly entries: readonly BibliographyEntry[];
  readonly hangingIndent: boolean;
  readonly secondFieldAlign: boolean;
}

export type CiteprocMode = "cached" | "incremental" | "rebuild";

export interface CitationResult {
  /** Rendered cluster per request, in request order. */
  readonly strings: readonly string[];
  readonly bibliography: Bibliography;
  readonly mode: CiteprocMode;
  readonly ms: number;
}

interface CslCitation {
  citationID: string;
  citationItems: Record<string, unknown>[];
  properties: { noteIndex: number };
}

interface CiteprocEngine {
  opt: { xclass: string };
  setOutputFormat(format: string): void;
  rebuildProcessorState(citations: CslCitation[], mode: string): [string, number, string][];
  processCitationCluster(
    citation: CslCitation,
    pre: [string, number][],
    post: [string, number][],
  ): [{ bibchange: boolean; citation_errors: unknown[] }, [number, string, string][]];
  makeBibliography(): [Record<string, unknown> & { entry_ids: string[][] }, string[]] | false;
  makeCitationCluster(items: Record<string, unknown>[]): string;
}

function cslCiteItem(item: CiteItem): Record<string, unknown> {
  const out: Record<string, unknown> = { id: item.key };
  if (item.locator) {
    out["locator"] = item.locator;
    out["label"] = item.label ?? "page";
  }
  if (item.prefix) out["prefix"] = `${item.prefix} `;
  if (item.suffix) out["suffix"] = item.suffix;
  if (item.suppressAuthor) out["suppress-author"] = true;
  return out;
}

const itemSignature = (r: CitationRequest) => JSON.stringify(r.items);

export class Citeproc {
  readonly isNoteStyle: boolean;
  private readonly engine: CiteprocEngine;
  private previous?: {
    signatures: string[];
    ids: string[];
    notes: number[];
    strings: string[];
    bibliography: Bibliography;
    keys: string;
  };
  private nextId = 0;

  constructor(
    styleXml: string,
    localeXml: string,
    private readonly library: ReadonlyMap<string, CslItem>,
  ) {
    const sys = {
      retrieveLocale: () => localeXml,
      retrieveItem: (id: string) => library.get(id),
      wrapCitationEntry: (str: string, id: string) => `#link(<ref-${typstLabel(id)}>)[${str}];`,
    };
    const Engine = CSL.Engine as unknown as new (sys: unknown, style: string, lang: string) => CiteprocEngine;
    this.engine = new Engine(sys, styleXml, "en-US");
    this.engine.setOutputFormat("typst");
    this.isNoteStyle = this.engine.opt.xclass === "note";
  }

  has(key: string): boolean {
    return this.library.has(key);
  }

  /** Author form for a narrative citation; "" when the style has none (numeric styles). */
  authorOnly(key: string, first: boolean): string {
    const s = this.engine.makeCitationCluster([{ id: key, "author-only": true, position: first ? 0 : 1 }]);
    return s.includes("NO_PRINTED_FORM") ? "" : s;
  }

  process(requests: readonly CitationRequest[], options: { forceRebuild?: boolean } = {}): CitationResult {
    const started = performance.now();
    const signatures = requests.map(itemSignature);
    const notes = requests.map((r) => r.noteIndex);
    const prev = this.previous;
    const done = (strings: string[], ids: string[], bibliography: Bibliography, mode: CiteprocMode): CitationResult => {
      this.previous = { signatures, ids, notes, strings, bibliography, keys: citedKeys(requests) };
      return { strings, bibliography, mode, ms: performance.now() - started };
    };

    if (prev && !options.forceRebuild) {
      if (sameArray(prev.signatures, signatures) && sameArray(prev.notes, notes)) {
        return { strings: prev.strings, bibliography: prev.bibliography, mode: "cached", ms: performance.now() - started };
      }
      const incremental = this.incremental(prev, requests, signatures, notes);
      if (incremental) {
        const bibliography = incremental.bibchange || citedKeys(requests) !== prev.keys ? this.bibliography(requests.length) : prev.bibliography;
        return done(incremental.strings, incremental.ids, bibliography, "incremental");
      }
    }
    const ids = requests.map(() => this.freshId());
    const citations = requests.map((r, i) => this.citation(ids[i] ?? "", r));
    const rebuilt = this.engine.rebuildProcessorState(citations, "typst");
    const byId = new Map(rebuilt.map(([id, , str]) => [id, str]));
    return done(ids.map((id) => byId.get(id) ?? ""), ids, this.bibliography(requests.length), "rebuild");
  }

  /**
   * A single inserted or changed cluster (with any number of note-number
   * shifts around it) goes through processCitationCluster. Returns null when
   * the change is not of that shape; the caller then rebuilds.
   */
  private incremental(
    prev: NonNullable<Citeproc["previous"]>,
    requests: readonly CitationRequest[],
    signatures: string[],
    notes: number[],
  ): { strings: string[]; ids: string[]; bibchange: boolean } | null {
    const n = prev.signatures.length;
    const m = signatures.length;
    let head = 0;
    while (head < n && head < m && prev.signatures[head] === signatures[head]) head++;
    let tail = 0;
    while (tail < n - head && tail < m - head && prev.signatures[n - 1 - tail] === signatures[m - 1 - tail]) tail++;
    const removed = n - head - tail;
    const added = m - head - tail;
    if (added !== 1 || removed > 1) return null;
    // Note numbers around an inserted note can shift; that is fine (pre/post
    // carry them). A shift elsewhere without a cluster change needs a rebuild.
    const ids = [...prev.ids.slice(0, head), removed === 1 ? (prev.ids[head] ?? this.freshId()) : this.freshId(), ...prev.ids.slice(n - tail)];
    const target = requests[head];
    const id = ids[head];
    if (!target || !id) return null;
    const pre = ids.slice(0, head).map((cid, i): [string, number] => [cid, notes[i] ?? 0]);
    const post = ids.slice(head + 1).map((cid, i): [string, number] => [cid, notes[head + 1 + i] ?? 0]);
    const [data, updates] = this.engine.processCitationCluster(this.citation(id, target), pre, post);
    const strings = [...prev.strings.slice(0, head), "", ...prev.strings.slice(n - tail)];
    for (const [index, str] of updates) strings[index] = str;
    return { strings, ids, bibchange: data.bibchange };
  }

  private citation(id: string, request: CitationRequest): CslCitation {
    return { citationID: id, citationItems: request.items.map(cslCiteItem), properties: { noteIndex: request.noteIndex } };
  }

  private freshId(): string {
    return `c${this.nextId++}`;
  }

  private bibliography(requestCount: number): Bibliography {
    const made = requestCount ? this.engine.makeBibliography() : false;
    if (!made) return { entries: [], hangingIndent: false, secondFieldAlign: false };
    const [meta, raw] = made;
    const secondFieldAlign = Boolean(meta["second-field-align"]);
    const entries = raw.map((s, i): BibliographyEntry => {
      const body = s.split(ENTRY_END).join("").trim();
      const key = String(meta.entry_ids[i]?.[0] ?? "");
      if (secondFieldAlign && body.includes(MARGIN_END)) {
        const [label = "", rest = ""] = body.split(MARGIN_END);
        return { key, label: label.trim(), body: rest.trim() };
      }
      return { key, body };
    });
    return { entries, hangingIndent: Boolean(meta["hangingindent"]), secondFieldAlign };
  }
}

function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

function citedKeys(requests: readonly CitationRequest[]): string {
  return [...new Set(requests.flatMap((r) => r.items.map((i) => i.key)))].sort().join("\u0000");
}
