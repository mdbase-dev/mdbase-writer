// A manuscript's chapters: records embedded on lines of their own, which the
// outline lists, reorders and adds to.

/** A record embedded on a line of its own in a body (a chapter), by its target as written. */
export interface ChapterEmbed {
  readonly target: string;
  /** Line index in the body. */
  readonly line: number;
}

const EMBED_LINE = /^ {0,3}!\[\[([^\]\n]+)\]\]\s*$/;

/** The body's chapter embeds, in order; the target leaves out any `#section` or `|alias`. */
export function chapterEmbeds(body: string): ChapterEmbed[] {
  const out: ChapterEmbed[] = [];
  body.split("\n").forEach((text, line) => {
    const target = EMBED_LINE.exec(text)?.[1]?.split(/[|#]/)[0]?.trim();
    if (target) out.push({ target, line });
  });
  return out;
}

/**
 * Moves the chapter embed at index `from` to index `to`. The embed lines trade
 * places; the text between them stays where it is.
 */
export function moveEmbed(body: string, from: number, to: number): string {
  const lines = body.split("\n");
  const slots = chapterEmbeds(body).map((e) => e.line);
  if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) return body;
  const texts = slots.map((i) => lines[i] ?? "");
  const [moved] = texts.splice(from, 1);
  texts.splice(to, 0, moved ?? "");
  slots.forEach((i, n) => (lines[i] = texts[n] ?? ""));
  return lines.join("\n");
}

/** Adds an embed after the last chapter (spaced as the chapters are), or at the end of the body. */
export function appendEmbed(body: string, target: string): string {
  const embed = `![[${target}]]`;
  const slots = chapterEmbeds(body).map((e) => e.line);
  const last = slots[slots.length - 1];
  if (last === undefined) return `${body.replace(/\s*$/, "")}${body.trim() ? "\n\n" : ""}${embed}\n`;
  const lines = body.split("\n");
  const tight = slots.length > 1 && last - (slots[slots.length - 2] ?? 0) === 1;
  lines.splice(last + 1, 0, ...(tight ? [embed] : ["", embed]));
  return lines.join("\n");
}
