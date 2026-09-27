// CodeMirror language for the writer's Markdown dialect: the same lezer
// extensions the translator parses with, plus highlighting for them.
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { styleTags, tags as t, Tag } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";
import { writerMarkdown } from "@mdbase-writer/core/markdown";

export const writerTags = {
  citation: Tag.define(),
  reference: Tag.define(),
  math: Tag.define(),
  footnote: Tag.define(),
  embed: Tag.define(),
};

const highlightNodes: MarkdownConfig = {
  props: [
    styleTags({
      Citation: writerTags.citation,
      AtReference: writerTags.reference,
      InlineMath: writerTags.math,
      MathBlock: writerTags.math,
      FootnoteReference: writerTags.footnote,
      FootnoteDefinition: writerTags.footnote,
      Wikilink: writerTags.embed,
      EmbedBlock: writerTags.embed,
    }),
  ],
};

const style = HighlightStyle.define([
  { tag: t.heading1, fontWeight: "700", fontSize: "1.25em" },
  { tag: t.heading2, fontWeight: "700", fontSize: "1.1em" },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], color: "var(--faint)" },
  { tag: [t.link, t.url], color: "var(--accent)" },
  { tag: t.monospace, fontFamily: "var(--mono)", fontSize: "0.9em" },
  { tag: t.quote, color: "var(--ink-soft)" },
  { tag: writerTags.citation, color: "var(--accent)" },
  { tag: writerTags.reference, color: "var(--accent)" },
  { tag: writerTags.math, fontFamily: "var(--mono)", fontSize: "0.9em", color: "var(--ink-soft)" },
  { tag: writerTags.footnote, color: "var(--ink-soft)" },
  { tag: writerTags.embed, color: "var(--connected)", fontFamily: "var(--mono)", fontSize: "0.9em" },
]);

export function writerLanguage() {
  return [markdown({ base: markdownLanguage, extensions: [writerMarkdown, highlightNodes], addKeymap: true }), syntaxHighlighting(style)];
}
