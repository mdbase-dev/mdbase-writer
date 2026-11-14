import { describe, expect, it } from "vitest";
import { annotationContract, commentContract, manuscriptContract, sourceContract, CollectionSchema, CollectionStore, type WriterSchemaDescription, type CollectionRow } from "./collection.js";
const impl = (name: string, fields: Record<string, string>) => ({ typeName: name, typeVersion: 1, digest: "test", fields });
const description: WriterSchemaDescription = {
  contracts: [
    [sourceContract, impl("book", { csl: "bib" })], [annotationContract, impl("highlight", { source: "reading", locator: "page" })],
    [commentContract, impl("feedback", { document: "about", created_at: "date", in_reply_to: "parent" })],
    [manuscriptContract, impl("paper", { title: "heading", template: "layout", csl: "style" })],
    [{ id: "mdbase.person", version: "2.0.0" }, impl("person", {})],
  ].map(([contract, binding]) => ({ ...contract as typeof sourceContract, contractType: "record", digest: "test", schema: {}, implementations: [binding as ReturnType<typeof impl>] })),
};
const row = (path: string, types: string[], contractFields: CollectionRow["contractFields"] = {}): CollectionRow => ({ path, types, contractFields, modified: "2026-01-01" });
const fresh = () => new CollectionStore(new CollectionSchema(description));
const sorted = <T>(map: ReadonlyMap<string, T>) => [...map].sort(([a], [b]) => a.localeCompare(b));
function snapshot(store: CollectionStore) {
  return { records: [...store.index.recordPaths].sort(), notes: [...store.index.notePaths].sort(), files: [...store.index.filePaths].sort(),
    library: store.library, manuscripts: store.manuscripts,
    annotations: sorted(store.annotations), comments: sorted(store.comments), people: sorted(store.people) };
}
describe("collection semantics", () => {
  it("classifies SDK contract projections across all domains, including multi-role records", () => {
    const store = fresh();
    store.upsert([
      row("main.md", ["paper"], { manuscript: { title: "Mapped", template: "book", csl: "apa" } }),
      row("sources/a.md", ["book"], { source: { csl: { id: "a", title: "Mapped book" } } }),
      row("annotations/a.md", ["highlight"], { annotation: { source: "[[../sources/a|A]]", locator: { label: "p. 5" } } }),
      row("comments/a.md", ["feedback"], { comment: { document: "[[main]]", created_at: "2026-01-01" } }),
      row("person.md", ["person"], { person: { name: "Person" } }), row("note.md", []),
      row("mixed.md", ["paper", "book"], { manuscript: { title: "Mixed" }, source: { csl: { id: "mixed" } } }),
    ]);
    expect(store.index.notePaths).toEqual(["main.md", "note.md"]);
    expect(store.library.map((e) => e.key)).toEqual(["mixed", "a"]);
    expect(store.manuscripts.find((m) => m.path === "main.md")).toMatchObject({ title: "Mapped", template: "book", style: "apa" });
    expect([...store.annotationsForSource("sources/a.md").keys()]).toEqual(["annotations/a.md"]);
    expect([...store.commentScope(["main.md"])]).toEqual(["comments/a.md"]);
    expect(store.people.get("person")).toBe("Person");
    expect(store.schema.bindings("manuscript")).toMatchObject({ ok: true, value: [{ name: "paper", fields: { title: "heading", template: "layout", csl: "style" } }] });
  });
  it("keeps the native record modification time alongside its contract projection", () => {
    const store = fresh();
    store.upsert([{ path: "paper.md", types: ["paper"], contractFields: { manuscript: { title: "Paper" } }, modified: "2026-01-02" }], true);
    expect(store.manuscripts).toEqual([{ path: "paper.md", title: "Paper", modified: "2026-01-02" }]);
  });
  it("retains stable snapshots for body-only note updates, and invalidates only affected annotations", () => {
    const store = fresh();
    store.upsert([row("note.md", []), row("sources/a.md", ["book"], { source: { csl: { id: "a" } } }), row("annotations/a.md", ["highlight"], { annotation: { source: "[[a]]" } })]);
    const index = store.index, library = store.library;
    store.annotationsForSource("sources/a.md");
    expect(store.upsert([row("note.md", [])])).toEqual({ paths: ["note.md"] });
    expect(store.index).toBe(index); expect(store.library).toBe(library);
    expect(store.upsert([row("annotations/a.md", ["highlight"], { annotation: { source: "[[a]]" } })])).toMatchObject({ annotations: true, annotationSources: ["sources/a.md"] });
    expect(store.remove(["sources/a.md"])).toMatchObject({ annotationSources: null });
  });
  it("keeps an invalid projection in the index without inventing source fields", () => {
    const store = fresh();
    store.upsert([row("source.md", ["book"])]);
    expect(store.index.recordPaths).toEqual(["source.md"]);
    expect(store.index.notePaths).toEqual([]);
    expect(store.library).toEqual([]);
  });
  it("incremental arbitrary changes equal a full rebuild of final rows (7,500 seeded changes)", () => {
    let seed = 8317;
    const random = (n: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
    const kinds = ["note", "book", "highlight", "feedback", "person", "paper", "reader-source", "reader-annotation", "comment", "writer-manuscript"];
    for (let run = 0; run < 50; run++) {
      const store = fresh(), final = new Map<string, CollectionRow>();
      store.files(["image.png"]);
      for (let step = 0; step < 150; step++) {
        const path = `records/${random(25)}.md`;
        if (random(41) === 0) { store.reset(); final.clear(); store.files(["image.png"]); }
        else if (random(5) === 0) { final.delete(path); store.remove([path]); }
        else {
          const type = kinds[random(kinds.length)]!;
          const contractFields: CollectionRow["contractFields"] = {
            source: { csl: { id: `key${random(5)}` } },
            manuscript: { title: String(random(7)) }, annotation: { source: "[[records/2]]" },
            comment: { document: "[[records/3]]", created_at: "2026-01-01" }, person: { name: "Person" },
          };
          const value = row(path, random(4) ? [type] : [type, "paper"], contractFields);
          final.set(path, value); store.upsert([value]);
        }
        if (step % 25 === 0 || step === 149) {
          const rebuilt = fresh(); rebuilt.upsert([...final.values()]); rebuilt.files(["image.png"]);
          expect(snapshot(store)).toEqual(snapshot(rebuilt));
          for (const source of rebuilt.library) expect(sorted(store.annotationsForSource(source.path))).toEqual(sorted(rebuilt.annotationsForSource(source.path)));
          expect([...store.commentScope(["records/3.md"])].sort()).toEqual([...rebuilt.commentScope(["records/3.md"])].sort());
        }
      }
      store.reset();
      expect(snapshot(store)).toEqual(snapshot(fresh()));
    }
  });
});
