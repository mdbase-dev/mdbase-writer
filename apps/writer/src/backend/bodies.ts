// Lazy hydration on top of classified metadata. No discovery or watch ownership.
import type { JsonObject, QueryRecord } from "@mdbase-dev/connect";
import { commentFromRecord, type CommentRecord } from "@mdbase-writer/core/comments";
import { CollectionCache } from "./cache.js";
import type { CollectionStore, StoreDelta } from "./collection.js";
import { toContract } from "./comments.js";
import { ok, sourceAnnotation, type Result, type SourceAnnotation } from "./types.js";

type ReadSelected = (metadata: ReadonlyMap<string, { readonly type: string }>) => Promise<Result<QueryRecord<JsonObject>[]>>;
export class CollectionBodies {
  private readonly comments = new Map<string, CommentRecord>();
  private readonly sources = new Map<string, CollectionCache<SourceAnnotation[]>>();
  constructor(private readonly store: () => CollectionStore, private readonly read: ReadSelected) {}

  changed(delta: StoreDelta): void {
    for (const path of delta.paths) this.comments.delete(path);
    if (delta.annotationSources === null) this.sources.clear();
    else for (const source of delta.annotationSources ?? []) this.sources.delete(source);
  }
  clear(): void { this.comments.clear(); this.sources.clear(); }

  annotationsForSource(path: string): Promise<Result<SourceAnnotation[]>> {
    let cache = this.sources.get(path);
    if (!cache) this.sources.set(path, cache = new CollectionCache());
    return cache.load(async () => {
      const selected = new Map(this.store().annotationsForSource(path));
      const loaded = await this.read(selected);
      if (!loaded.ok) return loaded;
      return ok(loaded.value.flatMap((row) => {
        const entry = selected.get(row.path);
        const a = entry && sourceAnnotation(row.path, toContract(row.frontmatter ?? {}, entry.fields), row.body ?? "");
        return a ? [a] : [];
      }));
    });
  }
  async commentsForScope(scope?: readonly string[]): Promise<Result<CommentRecord[]>> {
    const store = this.store();
    const wanted = new Map([...store.commentScope(scope)].map((p) => [p, store.comments.get(p)!]));
    const missing = new Map([...wanted].filter(([p]) => !this.comments.has(p)));
    const bodies = await this.read(missing);
    if (!bodies.ok) return bodies;
    for (const row of bodies.value) {
      const entry = wanted.get(row.path);
      // Reset or a path update during a read must not cache an old body.
      if (!entry || entry !== this.store().comments.get(row.path)) continue;
      const fields = Object.keys(entry.fields).length ? toContract(row.frontmatter ?? {}, entry.fields) : row.frontmatter ?? {};
      const comment = commentFromRecord(row.path, fields, row.body ?? "");
      if (comment) this.comments.set(row.path, comment);
    }
    return ok([...wanted.keys()].flatMap((p) => { const c = this.comments.get(p); return c ? [c] : []; }));
  }
}
