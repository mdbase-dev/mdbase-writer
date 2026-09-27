// Escaping for Typst markup, strings and labels.

const MARKUP_SPECIAL = /[\\#*_`$@<>[\]~]/g;

/** Text placed in Typst markup mode. */
export function escapeMarkup(text: string): string {
  return text.replace(MARKUP_SPECIAL, "\\$&").replace(/\/(?=[/*])/g, "\\/");
}

/** A Typst string literal. */
export function typstString(value: string): string {
  return `"${value
    .replace(/[\\"]/g, "\\$&")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")}"`;
}

/** Typst label names allow letters, digits, `_`, `-`, `:` and `.`. */
export function typstLabel(key: string): string {
  return key.replace(/[^\p{L}\p{N}_\-:.]/gu, "_");
}

/** Reverses escapeMarkup (for URLs that citeproc has already escaped). */
export function unescapeMarkup(text: string): string {
  return text.replace(/\\(.)/g, "$1");
}
