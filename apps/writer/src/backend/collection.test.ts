import type { CollectionDescription, JsonObject } from "@mdbase-dev/connect";
import { describe, expect, it } from "vitest";
import { annotationContract, commentContract, manuscriptContract, sourceContract, CollectionSchema, CollectionStore, starterSchema, type CollectionRow } from "./collection.js";
const impl = (name: string, fields: Record<string, string>) => ({ typeName: name, typeVersion: 1, digest: "test", fields });
const description: Pick<CollectionDescription, "types" | "contracts" | "configuration"> = {
  types: ["reader-source", "reader-annotation", "writer-manuscript", "comment", "person"].map((name) => ({ name, schema: {}, extensions: {} })),
  contracts: [
    [sourceContract, impl("book", { csl: "bib" })], [annotationContract, impl("highlight", { source: "reading", locator: "page" })],
    [commentContract, impl("feedback", { document: "about", created_at: "date", in_reply_to: "parent" })],
    [manuscriptContract, impl("paper", { title: "heading", template: "layout", csl: "style" })],
    [{ id: "mdbase.person", version: "2.0.0" }, impl("person", {})],
  ].map(([contract, binding]) => ({ ...contract as typeof sourceContract, contractType: "record", digest: "test", schema: {}, implementations: [binding as ReturnType<typeof impl>] })),
  configuration: { settings: { explicit_type_keys: ["kind"] } },
};
const row = (path: string, types: string[], fields: JsonObject = {}): CollectionRow => ({ path, types, frontmatter: fields, effectiveFrontmatter: fields, file: { mtime: "2026-01-01" } });
const fresh = () => new CollectionStore(new CollectionSchema(description));
const sorted = <T>(map: ReadonlyMap<string, T>) => [...map].sort(([a], [b]) => a.localeCompare(b));
function snapshot(store: CollectionStore) {
  return { records: [...store.index.recordPaths].sort(), notes: [...store.index.notePaths].sort(), files: [...store.index.filePaths].sort(),
    library: store.library, manuscripts: store.manuscripts,
    annotations: sorted(store.annotations), comments: sorted(store.comments), people: sorted(store.people) };
}
describe("collection semantics", () => {
  it("shares mappings and starter fallbacks across all domains, including multi-role records", () => {
    const store = fresh();
    store.upsert([
      row("main.md", ["paper"], { title: "Wrong", heading: "Mapped", layout: "book", style: "apa" }),
      row("sources/a.md", ["book"], { bib: { id: "a", title: "Mapped book" }, csl: { id: "wrong" } }),
      row("annotations/a.md", ["highlight"], { reading: "[[../sources/a|A]]", page: { label: "p. 5" } }),
      row("comments/a.md", ["feedback"], { about: "[[main]]", date: "2026-01-01" }),
      row("person.md", ["person"], { name: "Person" }), row("note.md", []),
      row("mixed.md", ["paper", "book"], { heading: "Mixed", bib: { id: "mixed" } }),
    ]);
    expect(store.index.notePaths).toEqual(["main.md", "note.md"]);
    expect(store.library.map((e) => e.key)).toEqual(["mixed", "a"]);
    expect(store.manuscripts.find((m) => m.path === "main.md")).toMatchObject({ title: "Mapped", template: "book", style: "apa" });
    expect([...store.annotationsForSource("sources/a.md").keys()]).toEqual(["annotations/a.md"]);
    expect([...store.commentScope(["main.md"])]).toEqual(["comments/a.md"]);
    expect(store.people.get("person")).toBe("Person");
    expect(store.schema.bindings("manuscript")).toMatchObject({ ok: true, value: [{ typeKey: "kind" }] });
  });
  it("classifies narrow values like full persisted discovery, including multi-role records and mtime", () => {
    const full = fresh(), narrow = fresh();
    const records = [
      row("sources/a.md", ["book"], { bib: { id: "a" }, title: "Fallback title", unrelated: "wide" }),
      row("mixed.md", ["paper", "highlight"], { heading: "Mixed", layout: "book", style: "apa", reading: "[[a]]", page: { label: "Not needed until hydrated" } }),
      row("comments/root.md", ["feedback"], { about: "[[mixed]]", date: "2026-01-01", target: { quote: { exact: "Large anchor" } } }),
      row("comments/reply.md", ["feedback"], { about: "[[elsewhere]]", date: "2026-01-02", parent: "[[root]]" }),
      row("note.md", []), row("person.md", ["person"], { name: "Person" }),
    ];
    full.upsert(records.map(({ effectiveFrontmatter: _effective, ...r }) => r), true);
    narrow.upsert(records.map((r) => ({ path: r.path, types: r.types,
      values: Object.fromEntries(narrow.schema.discoverySelect().flatMap((s) => {
        const field = /^record\[(.*)\]$/.exec(s.expression)?.[1];
        const value = field ? r.frontmatter?.[JSON.parse(field) as string] : s.expression === "file.mtime" ? r.file?.mtime : undefined;
        return value === undefined ? [] : [[s.name, value]];
      })),
    })), true);
    expect(snapshot(narrow)).toEqual(snapshot(full));
    expect([...narrow.annotationsForSource("sources/a.md").keys()]).toEqual(["mixed.md"]);
    expect([...narrow.commentScope(["mixed.md"])]).toEqual(["comments/root.md", "comments/reply.md"]);
    expect(narrow.manuscripts[0]?.modified).toBe("2026-01-01");
  });
  it("escapes literal mapped field names rather than interpreting dots or CEL syntax", () => {
    const schema = new CollectionSchema({ types: [], contracts: [{ ...annotationContract, contractType: "record", digest: "test", schema: {},
      implementations: [impl("highlight", { source: 'a.b["source"]' })] }] });
    expect(schema.discoverySelect()).toEqual([{ name: 'a.b["source"]', expression: 'record["a.b[\\"source\\"]"]' }]);
  });
  it("distinguishes structural starter roles from configured contract membership", () => {
    const store = fresh();
    store.upsert([row("unbound.md", ["reader-source"], { csl: { id: "ignored" } })]);
    expect(store.library).toEqual([]);
    expect(store.index.notePaths).toEqual([]);
    const schema = new CollectionSchema({ types: description.types, contracts: [] });
    expect(schema.setupStatus).toEqual({ sources: true, annotations: true, comments: false });
    expect(schema.bindings("comment")).toEqual({ ok: true, value: [] });
    const demo = new CollectionStore(starterSchema());
    demo.upsert([row("source.md", ["reader-source"], { csl: { id: "starter" } })]);
    expect(demo.library[0]?.key).toBe("starter");
  });
  it("retains stable snapshots for body-only note updates, and invalidates only affected annotations", () => {
    const store = fresh();
    store.upsert([row("note.md", []), row("sources/a.md", ["book"], { bib: { id: "a" } }), row("annotations/a.md", ["highlight"], { reading: "[[a]]" })]);
    const index = store.index, library = store.library;
    store.annotationsForSource("sources/a.md");
    expect(store.upsert([row("note.md", [], { changed: true })])).toEqual({ paths: ["note.md"] });
    expect(store.index).toBe(index); expect(store.library).toBe(library);
    expect(store.upsert([row("annotations/a.md", ["highlight"], { reading: "[[a]]" })])).toMatchObject({ annotations: true, annotationSources: ["sources/a.md"] });
    expect(store.remove(["sources/a.md"])).toMatchObject({ annotationSources: null });
  });
  it("effective discovery survives later persisted index rows and authoritative updates replace it", () => {
    const store = fresh();
    const persisted = row("source.md", ["book"]);
    store.upsert([{ ...persisted, effectiveFrontmatter: { bib: { id: "default" } } }]);
    store.upsert([{ path: persisted.path, types: persisted.types, file: {}, frontmatter: {} }], true);
    expect(store.library[0]?.key).toBe("default");
    store.upsert([persisted]);
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
          const fields: JsonObject = { bib: { id: `key${random(5)}` }, csl: { id: "starter" }, reading: "[[records/1]]", source: "[[records/2]]", about: "[[records/3]]", document: "[[records/4]]", date: "2026-01-01", created_at: "2026-01-01", heading: String(random(7)), title: "Starter", name: "Person" };
          let value = row(path, random(4) ? [type] : [type, "paper"], fields);
          if (random(3) === 0) { const { effectiveFrontmatter: _effective, ...persisted } = value; value = persisted; }
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
