// Reader annotations — a quotation and/or a note on a source — and embedding
// one as a quotation. `![[annotation]]` renders only the quotation, cited from
// the annotation's source and locator; the note stays private.
import { parseCiteItem } from "./cite-items.js";
import { resolveLinkTarget, type Frontmatter, type WriterRecord } from "./records.js";

/** A Reader annotation: a quotation and/or note on a source, with where it is in the source. */
export interface SourceAnnotation {
  readonly path: string;
  /** Collection path of the annotated source record. */
  readonly source: string;
  readonly quote: string | null;
  readonly note: string;
  /** Reader's locator label ("p. 12"), when it has one. */
  readonly locator?: string;
}

/** Reader's starter type for annotations (collections may implement the contract with others). */
export const ANNOTATION_TYPE = "reader-annotation";

/**
 * A Reader annotation record as the writer uses it. Reader links the source
 * as `[[path|title]]`; the first blockquote of the body is the quotation and
 * the rest is the note (as Reader's annotationBodyText splits it).
 */
export function sourceAnnotation(path: string, frontmatter: Frontmatter | undefined, body: string): SourceAnnotation | null {
  const link = typeof frontmatter?.["source"] === "string" ? frontmatter["source"] : "";
  const target = /^\[\[([^\]|#]+)/.exec(link.trim())?.[1]?.trim() ?? link.trim();
  if (!target) return null;
  const source = /\.md$/i.test(target) ? target : `${target}.md`;
  const locator = frontmatter?.["locator"];
  const rawLabel = locator && typeof locator === "object" && !Array.isArray(locator) ? (locator as Frontmatter)["label"] : undefined;
  const label = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel.trim() : undefined;
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const start = lines.findIndex((l) => /^ {0,3}>/.test(l));
  let end = start;
  if (start >= 0) while (end < lines.length && /^ {0,3}>/.test(lines[end] ?? "")) end++;
  const quote = start >= 0 ? lines.slice(start, end).map((l) => l.replace(/^ {0,3}> ?/, "")).join("\n").trim() || null : null;
  const note = (start >= 0 ? [...lines.slice(0, start), ...lines.slice(end)] : lines).join("\n").trim();
  if (!quote && !note) return null;
  return { path, source, quote, note, ...(label ? { locator: label } : {}) };
}

/** Whether a record is a Reader annotation: listed as one by the collection, or of Reader's starter type. */
export function isAnnotation(record: WriterRecord, annotationPaths?: ReadonlySet<string>): boolean {
  if (annotationPaths?.has(record.path)) return true;
  const type = record.frontmatter["type"];
  return type === ANNOTATION_TYPE || (Array.isArray(type) && type.includes(ANNOTATION_TYPE));
}

/** The citation for a source, with Reader's locator when it reads as one ("p. 12"). */
export function citationFor(key: string, locator?: string): string {
  const parsed = locator ? parseCiteItem(`@${key}, ${locator}`) : null;
  return parsed?.locator ? `[@${key}, ${locator}]` : `[@${key}]`;
}

/** Quotations up to this many words go inline; longer ones become block quotes (as most styles ask). */
export const INLINE_QUOTE_WORDS = 40;

/** Whether a quotation is short enough to run in the text. */
export const isInlineQuote = (quote: string) => quote.trim().split(/\s+/).length <= INLINE_QUOTE_WORDS;

/** An inline quotation in quotation marks, with its citation (no key: none). */
export function inlineQuotation(key: string | null, annotation: Pick<SourceAnnotation, "quote" | "locator">): string {
  const quote = (annotation.quote ?? "").replace(/\s+/g, " ").trim();
  return key ? `“${quote}” ${citationFor(key, annotation.locator)}` : `“${quote}”`;
}

/** A block quotation, its paragraphs kept, with the citation after its last line (no key: none). */
export function blockQuotation(key: string | null, annotation: Pick<SourceAnnotation, "quote" | "locator">): string {
  const lines = (annotation.quote ?? "").trim().split("\n").map((l) => l.trim());
  const quoted = lines.map((l) => (l ? `> ${l}` : ">"));
  if (key) quoted[quoted.length - 1] += ` ${citationFor(key, annotation.locator)}`;
  return quoted.join("\n");
}

/** The citekey of an annotation's source, from source record paths → citekeys. */
export function annotationKey(annotation: Pick<SourceAnnotation, "path" | "source">, sourceKeys: ReadonlyMap<string, string>): string | null {
  const path = resolveLinkTarget(annotation.source, annotation.path, new Set(sourceKeys.keys()));
  return path ? (sourceKeys.get(path) ?? null) : null;
}

export interface EmbeddedQuotation {
  /** The Markdown that stands in for the embed (empty when there is no quotation). */
  readonly markdown: string;
  /** The citekey it is cited with. */
  readonly key?: string;
  readonly problem?: { readonly severity: "error" | "warning"; readonly message: string };
}

/** What an embedded annotation renders as: its quotation as a block quote, cited. */
export function embeddedQuotation(record: WriterRecord, sourceKeys: ReadonlyMap<string, string>): EmbeddedQuotation {
  const annotation = sourceAnnotation(record.path, record.frontmatter, record.body);
  if (!annotation?.quote) return { markdown: "", problem: { severity: "error", message: `The annotation ${record.path} has no quotation to embed.` } };
  const key = annotationKey(annotation, sourceKeys);
  const markdown = blockQuotation(key, annotation);
  if (key) return { markdown, key };
  return { markdown, problem: { severity: "warning", message: `No source in the library matches ${annotation.source}, so the quotation from ${record.path} is not cited.` } };
}
