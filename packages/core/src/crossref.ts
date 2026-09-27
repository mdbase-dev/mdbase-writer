// Resolves Quarto cross-references in materialised Markdown into text, for
// plain Pandoc (which leaves `@fig-x` as "(fig-x?)"). Numbers follow the
// Typst templates: every heading not marked `.unnumbered` is numbered 1.1;
// labelled figures, tables and equations each have their own counter. The
// references read as Typst writes them ("Figure 2", "Section 1.3",
// "Equation (4)") in the document's language, and link to their target.
// Headings get their numbers written in, since Pandoc's Word writer does not
// number sections.
import type { SyntaxNode } from "@lezer/common";

import { parseCluster } from "./cite-items.js";
import { CITEKEY, markdownParser } from "./markdown.js";

export type CrossRefKind = "section" | "figure" | "table" | "equation";

export interface CrossRefTarget {
  readonly kind: CrossRefKind;
  /** As displayed: "1.2", "3", "(4)". */
  readonly number: string;
}

// Typst's supplements for the languages the writer has citation terms for.
const SUPPLEMENTS: Readonly<Record<string, Readonly<Record<CrossRefKind, string>>>> = {
  en: { section: "Section", figure: "Figure", table: "Table", equation: "Equation" },
  de: { section: "Abschnitt", figure: "Abbildung", table: "Tabelle", equation: "Gleichung" },
  fr: { section: "Section", figure: "Figure", table: "Tableau", equation: "Équation" },
  es: { section: "Sección", figure: "Figura", table: "Tabla", equation: "Ecuación" },
  it: { section: "Sezione", figure: "Figura", table: "Tabella", equation: "Equazione" },
  nl: { section: "Paragraaf", figure: "Figuur", table: "Tabel", equation: "Vergelijking" },
  pt: { section: "Seção", figure: "Figura", table: "Tabela", equation: "Equação" },
};

export function supplement(kind: CrossRefKind, lang: string): string {
  const table = SUPPLEMENTS[lang.toLowerCase().split(/[-_]/)[0] ?? "en"] ?? SUPPLEMENTS["en"];
  return (table ?? {})[kind] ?? kind;
}

const ATTRS = /\{([^{}]*)\}\s*$/;
const idOf = (attrs: string | undefined) => (attrs ? /(?:^|\s)#([\p{L}\p{N}_:.-]+)/u.exec(attrs)?.[1] : undefined);

/** Numbers every labelled target, and rewrites captions and equations to show their numbers. */
export function resolveCrossReferences(markdown: string, lang: string): { markdown: string; targets: Map<string, CrossRefTarget> } {
  const targets = new Map<string, CrossRefTarget>();
  const edits: { from: number; to: number; text: string }[] = [];
  const skip: [number, number][] = [];
  const sections: number[] = [];
  let figures = 0;
  let tables = 0;
  let equations = 0;
  const tree = markdownParser.parse(markdown);
  const text = (n: SyntaxNode) => markdown.slice(n.from, n.to);

  const visit = (node: SyntaxNode) => {
    const heading = /^(?:ATXHeading|SetextHeading)(\d)$/.exec(node.name);
    if (heading) {
      const level = Number(heading[1]);
      const attrs = ATTRS.exec(text(node).split("\n")[0] ?? "")?.[1];
      if (!attrs || !/(?:^|\s)(?:\.unnumbered|-)(?:\s|$)/.test(attrs)) {
        sections.length = level;
        for (let i = 0; i < level - 1; i++) sections[i] ??= 0;
        sections[level - 1] = (sections[level - 1] ?? 0) + 1;
        const number = sections.join(".");
        const id = idOf(attrs);
        if (id) targets.set(id, { kind: "section", number });
        const mark = node.getChild("HeaderMark");
        const at = mark && mark.from === node.from ? mark.to + (/^[ \t]/.test(markdown.slice(mark.to, mark.to + 1)) ? 1 : 0) : node.from;
        edits.push({ from: at, to: at, text: `${number} ` });
      }
      return;
    }
    switch (node.name) {
      case "FencedCode":
      case "CodeBlock":
      case "InlineCode":
      case "InlineMath":
        skip.push([node.from, node.to]);
        return;
      case "MathBlock": {
        skip.push([node.from, node.to]);
        const m = /^\$\$([\s\S]*?)\$\$\s*\{([^}]*)\}\s*$/.exec(text(node));
        const id = idOf(m?.[2]);
        if (!m || !id) return;
        const number = `(${++equations})`;
        targets.set(id, { kind: "equation", number });
        edits.push({ from: node.from, to: node.to, text: `[$$${(m[1] ?? "").trimEnd()} \\qquad ${number}$$]{#${id}}` });
        return;
      }
      case "Paragraph": {
        const raw = text(node);
        // A figure: an image alone in its paragraph, with an id.
        const figure = /^!\[([\s\S]*?)\]\(([^)]*)\)\{([^}]*)\}\s*$/.exec(raw);
        const figureId = idOf(figure?.[3]);
        if (figure && figureId) {
          const number = String(++figures);
          targets.set(figureId, { kind: "figure", number });
          const caption = (figure[1] ?? "").trim();
          const label = `${supplement("figure", lang)} ${number}`;
          edits.push({ from: node.from, to: node.to, text: `![${caption ? `${label}: ${caption}` : label}](${figure[2]}){${figure[3]}}` });
          return;
        }
        // A table caption: ": Caption {#tbl-x}" or "Table: Caption {#tbl-x}" after a table.
        const caption = /^(:|Table:)\s*([\s\S]*?)\s*\{([^}]*)\}\s*$/.exec(raw);
        const tableId = idOf(caption?.[3]);
        if (caption && tableId && node.prevSibling?.name === "Table") {
          const number = String(++tables);
          targets.set(tableId, { kind: "table", number });
          edits.push({ from: node.from, to: node.to, text: `: [${supplement("table", lang)} ${number}: ${caption[2]}]{#${tableId}}` });
          return;
        }
        break;
      }
    }
    for (let c = node.firstChild; c; c = c.nextSibling) visit(c);
  };
  visit(tree.topNode);

  const reference = (key: string) => {
    const t = targets.get(key);
    return t ? `[${supplement(t.kind, lang)} ${t.number}](#${key})` : undefined;
  };
  // References: bracketed clusters made only of labels, then bare @label.
  // Footnote definitions keep their inline text unparsed, so this works on
  // the text, skipping code and math.
  const skipped = (from: number, to: number) => skip.some(([a, b]) => from < b && to > a) || edits.some((e) => e.to > e.from && from < e.to && to > e.from);
  const cluster = new RegExp(`\\[([^\\[\\]]*?@${CITEKEY.source}[^\\[\\]]*)\\](?![({])`, "gu");
  for (const m of markdown.matchAll(cluster)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (skipped(from, to)) continue;
    const items = parseCluster(m[1] ?? "");
    if (!items.length || !items.every((i) => targets.has(i.key))) {
      skip.push([from, to]); // a citation (or a mixed cluster, an error the preview reports): leave it whole
      continue;
    }
    edits.push({
      from,
      to,
      text: items.map((i) => `${i.prefix ? `${i.prefix} ` : ""}${reference(i.key)}${i.suffix}`).join(", "),
    });
  }
  const bare = new RegExp(`(^|[^\\p{L}\\p{N}_@\\[-])@(${CITEKEY.source})`, "gu");
  for (const m of markdown.matchAll(bare)) {
    const from = (m.index ?? 0) + (m[1]?.length ?? 0);
    const key = m[2] ?? "";
    const to = from + 1 + key.length;
    const link = reference(key);
    if (!link || skipped(from, to)) continue;
    edits.push({ from, to, text: link });
  }

  let out = markdown;
  for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return { markdown: out, targets };
}
