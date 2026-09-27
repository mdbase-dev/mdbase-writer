// The writer's Markdown dialect: CommonMark + GFM tables/strikethrough, plus
// the Pandoc/Quarto conventions for scholarly writing and mdbase embeds.
// The same extensions configure the CodeMirror language, so the editor and
// the translator agree on every offset.
import {
  parser as baseParser,
  GFM,
  type BlockContext,
  type InlineContext,
  type Line,
  type MarkdownConfig,
} from "@lezer/markdown";

const CHAR_AT = 64;
const CHAR_OPEN_BRACKET = 91;
const CHAR_CLOSE_BRACKET = 93;
const CHAR_DOLLAR = 36;
const CHAR_BANG = 33;
const CHAR_CARET = 94;
const CHAR_BACKSLASH = 92;
const CHAR_PAREN = 40;

/** Pandoc citekey: starts with a letter, digit or _, may contain internal punctuation. */
export const CITEKEY = /[\p{L}\p{N}_](?:[\p{L}\p{N}_:.#$%&\-+?<>~/]*[\p{L}\p{N}_])?/u;
const CITEKEY_AT_START = new RegExp(`^${CITEKEY.source}`, "u");
const WORD_CHAR = /[\p{L}\p{N}_]/u;
const ITEM_HAS_KEY = /(?:^|[^\p{L}\p{N}_])-?@[\p{L}\p{N}_]/u;

function matchingBracket(cx: InlineContext, open: number): number {
  let depth = 0;
  for (let i = open; i < cx.end; i++) {
    const ch = cx.char(i);
    if (ch === CHAR_BACKSLASH) {
      i++;
      continue;
    }
    if (ch === CHAR_OPEN_BRACKET) depth++;
    else if (ch === CHAR_CLOSE_BRACKET && --depth === 0) return i;
  }
  return -1;
}

export const writerMarkdown: MarkdownConfig = {
  defineNodes: [
    "Citation",
    "AtReference",
    "InlineMath",
    "FootnoteReference",
    "Wikilink",
    "FootnoteDefinition",
    "MathBlock",
    "EmbedBlock",
  ],
  parseInline: [
    {
      name: "FootnoteReference",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== CHAR_OPEN_BRACKET || cx.char(pos + 1) !== CHAR_CARET) return -1;
        const m = /^\[\^[^\]\s]+\]/.exec(cx.slice(pos, cx.end));
        return m ? cx.addElement(cx.elt("FootnoteReference", pos, pos + m[0].length)) : -1;
      },
    },
    {
      name: "Wikilink",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== CHAR_OPEN_BRACKET || cx.char(pos + 1) !== CHAR_OPEN_BRACKET) return -1;
        const m = /^\[\[[^\]\n]+\]\]/.exec(cx.slice(pos, cx.end));
        return m ? cx.addElement(cx.elt("Wikilink", pos, pos + m[0].length)) : -1;
      },
    },
    {
      // [see @a, 12; @b]: every ;-separated item contains a key, and a
      // following ( or [ makes it a link instead.
      name: "Citation",
      before: "Link",
      parse(cx, next, pos) {
        if (next !== CHAR_OPEN_BRACKET) return -1;
        const close = matchingBracket(cx, pos);
        if (close < 0) return -1;
        const after = cx.char(close + 1);
        if (after === CHAR_PAREN || after === CHAR_OPEN_BRACKET) return -1;
        const items = cx.slice(pos + 1, close).split(";");
        if (!items.every((item) => ITEM_HAS_KEY.test(item))) return -1;
        return cx.addElement(cx.elt("Citation", pos, close + 1));
      },
    },
    {
      name: "AtReference",
      parse(cx, next, pos) {
        if (next !== CHAR_AT) return -1;
        if (pos > cx.offset && WORD_CHAR.test(String.fromCharCode(cx.char(pos - 1)))) return -1;
        const m = CITEKEY_AT_START.exec(cx.slice(pos + 1, cx.end));
        return m ? cx.addElement(cx.elt("AtReference", pos, pos + 1 + m[0].length)) : -1;
      },
    },
    {
      // Pandoc tex_math_dollars: the opening $ is not followed by space; the
      // closing $ is not preceded by space nor followed by a digit.
      name: "InlineMath",
      before: "Emphasis",
      parse(cx, next, pos) {
        if (next !== CHAR_DOLLAR || cx.char(pos + 1) === CHAR_DOLLAR) return -1;
        const first = cx.char(pos + 1);
        if (first === 32 || first === 10 || first === -1) return -1;
        for (let i = pos + 1; i < cx.end; i++) {
          const ch = cx.char(i);
          if (ch === CHAR_BACKSLASH) {
            i++;
            continue;
          }
          if (ch === CHAR_DOLLAR) {
            const before = cx.char(i - 1);
            const after = cx.char(i + 1);
            if (before === 32 || (after >= 48 && after <= 57)) return -1;
            return cx.addElement(cx.elt("InlineMath", pos, i + 1));
          }
        }
        return -1;
      },
    },
  ],
  parseBlock: [
    {
      // [^id]: text, continued by lines indented four or more spaces.
      name: "FootnoteDefinition",
      before: "LinkReference",
      parse(cx: BlockContext, line: Line) {
        if (line.indent !== 0 || !/^\[\^[^\]\s]+\]:/.test(line.text)) return false;
        const start = cx.lineStart;
        let end = start + line.text.length;
        while (cx.nextLine()) {
          if (line.text.trim() === "") continue;
          if (line.indent < 4) break;
          end = cx.lineStart + line.text.length;
        }
        cx.addElement(cx.elt("FootnoteDefinition", start, end));
        return true;
      },
    },
    {
      // $$ … $$ {#eq-x}
      name: "MathBlock",
      before: "FencedCode",
      parse(cx: BlockContext, line: Line) {
        if (!line.text.slice(line.pos).startsWith("$$")) return false;
        const start = cx.lineStart + line.pos;
        if (/\$\$\s*(\{[^}]*\})?\s*$/.test(line.text.slice(line.pos + 2))) {
          cx.addElement(cx.elt("MathBlock", start, cx.lineStart + line.text.length));
          cx.nextLine();
          return true;
        }
        while (cx.nextLine()) {
          if (/^\s*\$\$\s*(\{[^}]*\})?\s*$/.test(line.text)) {
            cx.addElement(cx.elt("MathBlock", start, cx.lineStart + line.text.length));
            cx.nextLine();
            return true;
          }
        }
        cx.addElement(cx.elt("MathBlock", start, cx.lineStart));
        return true;
      },
    },
    {
      // A line holding only ![[target]]: a record to include, or an image.
      name: "EmbedBlock",
      parse(cx: BlockContext, line: Line) {
        if (line.next !== CHAR_BANG) return false;
        if (!/^!\[\[[^\]\n]+\]\](\{[^}]*\})?\s*$/.test(line.text.slice(line.pos))) return false;
        cx.addElement(cx.elt("EmbedBlock", cx.lineStart + line.pos, cx.lineStart + line.text.length));
        cx.nextLine();
        return true;
      },
    },
  ],
};

export const markdownParser = baseParser.configure([GFM, writerMarkdown]);
