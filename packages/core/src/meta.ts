// Manuscript settings from the main record's frontmatter.
import { resolveLinkTarget, type Frontmatter } from "./records.js";

export const TEMPLATES = ["article", "thesis"] as const;
export type TemplateName = (typeof TEMPLATES)[number];
export const DEFAULT_STYLE = "chicago-notes-bibliography";
export const DEFAULT_LOCALE = "en-US";

/** Frontmatter fields the settings panel edits; problems point at one of them. */
export type MetaField = "title" | "subtitle" | "authors" | "abstract" | "date" | "csl" | "template" | "lang";

export interface ManuscriptMeta {
  readonly title?: string;
  readonly subtitle?: string;
  readonly authors: readonly { name: string; affiliation?: string }[];
  readonly abstract?: string;
  readonly date?: string;
  /** A bundled style id, or the collection path of a .csl file. */
  readonly style: string;
  /** A bundled template name, or the collection path of a .typ file. */
  readonly template: string;
  readonly customTemplate: boolean;
  /** The document language (BCP 47, as written), for hyphenation and Pandoc. */
  readonly lang: string;
  /** The CSL locale citations are formatted with (a key of `locales`). */
  readonly locale: string;
  /** True when the language was set explicitly (it then overrides the style's default-locale). */
  readonly forceLocale: boolean;
}

export interface MetaProblem {
  readonly field: MetaField;
  readonly message: string;
}

export interface MetaContext {
  /** Bundled styles by id. */
  readonly styles: ReadonlyMap<string, string>;
  /** CSL locales by tag (en-US, en-GB, …). */
  readonly locales?: ReadonlySet<string>;
  /** The main record's path (collection files resolve relative to it). */
  readonly main?: string;
  /** Every non-record file in the collection. */
  readonly filePaths?: ReadonlySet<string>;
  /** Collection text files loaded so far (styles, templates), by path. */
  readonly texts?: ReadonlyMap<string, string>;
}

export interface MetaResult {
  readonly meta: ManuscriptMeta;
  readonly problems: MetaProblem[];
  /** Collection files the settings name that are not loaded yet. */
  readonly needs: string[];
}

export function manuscriptMeta(frontmatter: Frontmatter, context: MetaContext): MetaResult {
  const problems: MetaProblem[] = [];
  const needs: string[] = [];
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
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

  /** A collection file named by a setting: its path once loaded, or null (with a need or a problem recorded). */
  const collectionFile = (field: MetaField, value: string, kind: string): string | null => {
    const resolved = context.filePaths ? resolveLinkTarget(value, context.main ?? "", context.filePaths, "") : null;
    if (!resolved) {
      problems.push({ field, message: `No file in the collection matches the ${kind} ${value}.` });
      return null;
    }
    if (context.texts?.has(resolved)) return resolved;
    needs.push(resolved);
    return null;
  };

  const requestedStyle = str(frontmatter["csl"]) ?? str(frontmatter["citation_style"]) ?? DEFAULT_STYLE;
  let style: string = DEFAULT_STYLE;
  if (context.styles.has(requestedStyle)) style = requestedStyle;
  else if (/\.csl$/i.test(requestedStyle)) style = collectionFile("csl", requestedStyle, "citation style") ?? DEFAULT_STYLE;
  else problems.push({ field: "csl", message: `Unknown citation style "${requestedStyle}"; using ${DEFAULT_STYLE}.` });

  const requestedTemplate = str(frontmatter["template"]) ?? "article";
  let template: string = "article";
  let customTemplate = false;
  if ((TEMPLATES as readonly string[]).includes(requestedTemplate)) template = requestedTemplate;
  else if (/\.typ$/i.test(requestedTemplate)) {
    const file = collectionFile("template", requestedTemplate, "template");
    if (file) {
      template = file;
      customTemplate = true;
    }
  } else problems.push({ field: "template", message: `Unknown template "${requestedTemplate}"; using article.` });

  // Pandoc's order: the lang field, then the style's default-locale, then en-US.
  const explicitLang = str(frontmatter["lang"]);
  const styleXml = context.styles.get(style) ?? context.texts?.get(style) ?? "";
  const lang = explicitLang ?? /<style\b[^>]*\bdefault-locale="([^"]+)"/.exec(styleXml)?.[1] ?? DEFAULT_LOCALE;
  const locale = matchLocale(lang, context.locales);
  if (explicitLang && !locale) problems.push({ field: "lang", message: `Citations have no terms for "${explicitLang}"; they use ${DEFAULT_LOCALE}.` });

  const title = str(frontmatter["title"]);
  const subtitle = str(frontmatter["subtitle"]);
  const abstract = str(frontmatter["abstract"]);
  const rawDate = frontmatter["date"];
  // YAML reads `date: 2026` as a number and `date: 2026-09-27` as a Date.
  const date = rawDate instanceof Date ? rawDate.toISOString().slice(0, 10) : typeof rawDate === "number" ? String(rawDate) : str(rawDate);
  return {
    meta: {
      authors,
      style,
      template,
      customTemplate,
      lang,
      locale: locale ?? DEFAULT_LOCALE,
      forceLocale: Boolean(explicitLang && locale),
      ...(title ? { title } : {}),
      ...(subtitle ? { subtitle } : {}),
      ...(abstract ? { abstract } : {}),
      ...(date ? { date } : {}),
    },
    problems,
    needs,
  };
}

/** The locale for a language tag: exact (case-insensitive), then the first with the same language. */
export function matchLocale(lang: string, locales: ReadonlySet<string> | undefined): string | undefined {
  const all = [...(locales ?? [DEFAULT_LOCALE])];
  const lower = lang.toLowerCase().replace(/_/g, "-");
  return all.find((l) => l.toLowerCase() === lower) ?? all.find((l) => l.toLowerCase().split("-")[0] === lower.split("-")[0]);
}

/** Typst's text language and region for a BCP 47 tag ("en-GB" → en, gb). */
export function typstLanguage(lang: string): { lang: string; region?: string } {
  const [language = "en", ...rest] = lang.toLowerCase().replace(/_/g, "-").split("-");
  const region = rest.find((p) => /^[a-z]{2}$/.test(p));
  return { lang: /^[a-z]{2,3}$/.test(language) ? language : "en", ...(region ? { region } : {}) };
}
