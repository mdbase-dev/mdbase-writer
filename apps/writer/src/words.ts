// Counting a manuscript's words.

/**
 * Words of prose in Markdown, roughly as a reader would count them: code,
 * math, citations, cross-reference attributes, embeds, footnote markers and
 * link targets are left out.
 */
export function wordCount(markdown: string): number {
  const prose = markdown
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[^\n]*|$)/gm, " ")
    .replace(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!\[\[[^\]\n]*\]\]/g, " ")
    .replace(/\[\[([^\]|\n]*\|)?([^\]\n]*)\]\]/g, "$2")
    .replace(/\[-?@[^\]\n]*\]/g, " ")
    .replace(/(^|[\s(])-?@[\p{L}\p{N}_][\p{L}\p{N}_:.#$%&\-+?<>~/]*/gu, "$1ref")
    .replace(/\{[#.][^}\n]*\}/g, " ")
    .replace(/\[\^[^\]\n]+\]:?/g, " ")
    .replace(/\]\([^)\n]*\)/g, "]")
    .replace(/<[^>\n]+>/g, " ");
  return prose.match(/[\p{L}\p{N}]+(?:['’.-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/** Records embedded on a line of their own (`![[chapters/one]]`). */
export function embedCount(body: string): number {
  return body.match(/^ {0,3}!\[\[[^\]\n]+\]\]\s*$/gm)?.length ?? 0;
}
