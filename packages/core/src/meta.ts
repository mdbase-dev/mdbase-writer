// Manuscript settings from the main record's frontmatter.
import type { Frontmatter } from "./records.js";

export const TEMPLATES = ["article", "thesis"] as const;
export type TemplateName = (typeof TEMPLATES)[number];
export const DEFAULT_STYLE = "chicago-notes-bibliography";

export interface ManuscriptMeta {
  readonly title?: string;
  readonly subtitle?: string;
  readonly authors: readonly { name: string; affiliation?: string }[];
  readonly abstract?: string;
  readonly date?: string;
  readonly style: string;
  readonly template: TemplateName;
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
