// A manuscript's chapters: records embedded on lines of their own, which the
// outline lists, reorders and adds to. An embedded annotation is a quotation,
// not a chapter; `isChapter` says which targets are chapters.

/** A record embedded on a line of its own in a body (a chapter), by its target as written. */
export interface ChapterEmbed {
  readonly target: string;
  /** Line index in the body. */
  readonly line: number;
}

/** A line holding only an embed; group 1 is the target as written. */
export const EMBED_LINE = /^ {0,3}!\[\[([^\]\n]+)\]\]\s*$/;

/** Which embed targets are chapters (by default, all of them). */
export type IsChapter = (target: string) => boolean;

/** The target of a line holding only an embed, without any `#section` or `|alias`. */
export const embedTarget = (line: string): string | undefined => EMBED_LINE.exec(line)?.[1]?.split(/[|#]/)[0]?.trim() || undefined;

/** The body's chapter embeds, in order. */
export function chapterEmbeds(body: string, isChapter: IsChapter = () => true): ChapterEmbed[] {
  const out: ChapterEmbed[] = [];
  body.split("\n").forEach((text, line) => {
    const target = embedTarget(text);
    if (target && isChapter(target)) out.push({ target, line });
  });
  return out;
}

/**
 * Moves the chapter embed at index `from` to index `to`. The embed lines trade
 * places; the text between them stays where it is.
 */
export function moveEmbed(body: string, from: number, to: number, isChapter?: IsChapter): string {
  const lines = body.split("\n");
  const slots = chapterEmbeds(body, isChapter).map((e) => e.line);
  if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) return body;
  const texts = slots.map((i) => lines[i] ?? "");
  const [moved] = texts.splice(from, 1);
  texts.splice(to, 0, moved ?? "");
  slots.forEach((i, n) => (lines[i] = texts[n] ?? ""));
  return lines.join("\n");
}

/** Adds an embed after the last chapter (spaced as the chapters are), or at the end of the body. */
export function appendEmbed(body: string, target: string, isChapter?: IsChapter): string {
  const embed = `![[${target}]]`;
  const slots = chapterEmbeds(body, isChapter).map((e) => e.line);
  const last = slots[slots.length - 1];
  if (last === undefined) return `${body.replace(/\s*$/, "")}${body.trim() ? "\n\n" : ""}${embed}\n`;
  const lines = body.split("\n");
  const tight = slots.length > 1 && last - (slots[slots.length - 2] ?? 0) === 1;
  lines.splice(last + 1, 0, ...(tight ? [embed] : ["", embed]));
  return lines.join("\n");
}
