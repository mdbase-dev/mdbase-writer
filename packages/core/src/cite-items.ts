// Pandoc citation items: `[see @key, p. 33, for details]`, `[-@key]`.
import { CITEKEY } from "./markdown.js";

export interface CiteItem {
  readonly key: string;
  readonly prefix: string;
  readonly suffix: string;
  readonly locator?: string;
  readonly label?: string;
  readonly suppressAuthor: boolean;
}

/** Pandoc's locator terms mapped to CSL locator labels. */
const LOCATOR_LABELS: Readonly<Record<string, string>> = {
  p: "page", pp: "page", page: "page", pages: "page",
  ch: "chapter", chap: "chapter", chapter: "chapter", chapters: "chapter",
  sec: "section", secs: "section", section: "section", sections: "section", "§": "section", "§§": "section",
  para: "paragraph", paras: "paragraph", paragraph: "paragraph",
  n: "note", nn: "note", note: "note", notes: "note",
  vol: "volume", vols: "volume", volume: "volume",
  l: "line", ll: "line", line: "line", lines: "line",
  fig: "figure", figs: "figure", figure: "figure",
  bk: "book", book: "book", pt: "part", part: "part", col: "column", column: "column",
};

const LOCATOR = new RegExp(
  `^(?:(${Object.keys(LOCATOR_LABELS).sort((a, b) => b.length - a.length).join("|")})\\.?\\s*)?` +
    "([\\p{N}ivxlcdmIVXLCDM]+[a-z]?(?:\\s*(?:--?-?|–|—|,|&)\\s*[\\p{N}ivxlcdmIVXLCDM]+[a-z]?)*)(?=$|[\\s,;])",
  "u",
);
const ITEM = new RegExp(`^([\\s\\S]*?)(-?)@(${CITEKEY.source})([\\s\\S]*)$`, "u");

export function parseCiteItem(raw: string): CiteItem | null {
  const m = ITEM.exec(raw);
  if (!m) return null;
  const [, prefix = "", minus = "", key = "", rest = ""] = m;
  let remainder = rest;
  let locator: string | undefined;
  let label: string | undefined;
  const comma = /^\s*,\s*/.exec(remainder);
  if (comma) {
    const after = remainder.slice(comma[0].length);
    const loc = LOCATOR.exec(after);
    if (loc && (loc[1] || /^\p{N}/u.test(loc[2] ?? "") || /^[ivxlcdm]+$/i.test(loc[2] ?? ""))) {
      label = LOCATOR_LABELS[loc[1] ?? "p"] ?? "page";
      // citeproc formats ranges (and page-range-format) from plain hyphens.
      locator = (loc[2] ?? "").replace(/--?-?|–|—/g, "-");
      remainder = after.slice(loc[0].length);
    }
  }
  return {
    key,
    prefix: prefix.trim(),
    suffix: remainder.replace(/\s+$/, ""),
    suppressAuthor: minus === "-",
    ...(locator !== undefined ? { locator } : {}),
    ...(label !== undefined ? { label } : {}),
  };
}

/** Splits a bracketed citation's inner text into items. */
export function parseCluster(inner: string): CiteItem[] {
  return inner.split(";").flatMap((part) => {
    const item = parseCiteItem(part);
    return item ? [item] : [];
  });
}
