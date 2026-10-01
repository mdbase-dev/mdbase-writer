import { labelTargets, referenceKeys, type LabelTarget } from "../editor/insight.js";
import { wordCount } from "../words.js";
import type { LibraryEntry } from "../backend/types.js";
import type { RecordView } from "../workspace/workspace.js";

const sameCounts = (a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
export class ManuscriptStats {
  private rows = new Map<string, { body: string; words: number; labels: Map<string, LabelTarget>; keys: string[] }>();
  private previous: { words: number; labels: Map<string, LabelTarget>; cited: Map<string, number> } | undefined;
  private library: readonly LibraryEntry[] | undefined;
  private keys = new Set<string>();
  private order: readonly string[] | undefined;
  derive(order: readonly string[], records: ReadonlyMap<string, RecordView>, library: readonly LibraryEntry[]) {
    let changed = this.library !== library || this.order !== order;
    if (this.library !== library) { this.library = library; this.keys = new Set(library.map((e) => e.key)); }
    this.order = order;
    for (const path of order) {
      const view = records.get(path);
      const body = view?.snapshot.state === "deleted" ? undefined : view?.snapshot.body;
      if (body === undefined) { if (this.rows.delete(path)) changed = true; continue; }
      if (this.rows.get(path)?.body === body) continue;
      changed = true;
      this.rows.set(path, { body, words: wordCount(body), labels: new Map(labelTargets(path, body)), keys: referenceKeys(body) });
    }
    if (!changed && this.previous) return this.previous;
    const present = new Set(order);
    for (const path of this.rows.keys()) if (!present.has(path)) this.rows.delete(path);
    let words = 0;
    let labels = new Map<string, LabelTarget>(), cited = new Map<string, number>();
    for (const path of order) {
      const row = this.rows.get(path); if (!row) continue;
      words += row.words;
      for (const [key, target] of row.labels) if (!labels.has(key)) labels.set(key, target);
      for (const key of row.keys) if (this.keys.has(key)) cited.set(key, (cited.get(key) ?? 0) + 1);
    }
    if (this.previous && sameCounts(cited, this.previous.cited)) cited = this.previous.cited;
    if (this.previous && JSON.stringify([...labels]) === JSON.stringify([...this.previous.labels])) labels = this.previous.labels;
    return this.previous = { words, labels, cited };
  }
}
