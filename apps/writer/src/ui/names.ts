// Names people read for the settings' stored values.
import { STYLES } from "@mdbase-writer/core/styles";

/** A bundled layout's name, or a collection template's file name. */
export function templateName(template: string): string {
  if (template === "article") return "Article";
  if (template === "thesis") return "Thesis or book";
  return template.split("/").pop() ?? template;
}

/** A bundled citation style's title, or a collection style's file name. */
export function styleName(style: string): string {
  return STYLES.find((s) => s.id === style)?.title ?? style.split("/").pop() ?? style;
}

/** When something was last edited, as people say it ("3 days ago"; a date after a week). */
export function relativeTime(iso: string, now = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "";
  const minutes = Math.round((now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(then).toLocaleDateString(undefined, { day: "numeric", month: "short", year: new Date(then).getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

/** A note's name from its path, as a title would read ("drafts/on-inoperativity.md" → "On inoperativity"). */
export function noteName(path: string): string {
  const base = (path.split("/").pop() ?? path).replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : path;
}

/** Manuscripts by when they were last edited, newest first; those without a time after, by title. */
export function byRecentlyEdited<T extends { readonly title: string; readonly modified?: string }>(list: readonly T[]): T[] {
  const time = (m: T) => (m.modified ? Date.parse(m.modified) : Number.NaN);
  return [...list].sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    if (Number.isNaN(ta) !== Number.isNaN(tb)) return Number.isNaN(ta) ? 1 : -1;
    return (Number.isNaN(ta) ? 0 : tb - ta) || a.title.localeCompare(b.title);
  });
}
