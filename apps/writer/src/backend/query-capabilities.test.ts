// Probe the installed producer, not a synthetic implementation of asFile().
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collection } from "@callumalpass/mdbase";
import { LinkResolver } from "../../node_modules/@callumalpass/mdbase/dist/operations/link-resolver.js";
import { MdbaseCollectionClient } from "@mdbase-dev/connect/advanced";
import { createRecordTestAuthority } from "@mdbase-dev/connect-testing";
import { PathIndex, resolveLinkTarget } from "@mdbase-writer/core/records";
import { describe, expect, it } from "vitest";

describe("installed query capability boundaries", () => {
  it("projections remain additive; native CEL asFile is not implemented in this mdbase", async () => {
    const root = await mkdtemp(join(tmpdir(), "writer-capabilities-"));
    let collection: Collection | undefined;
    const authority = createRecordTestAuthority();
    try {
      await Collection.init(root, { config: { name: "Capabilities" } });
      await mkdir(join(root, "_types"), { recursive: true });
      await writeFile(join(root, "_types/probe.md"), "---\nkind: mdbase.type\nname: probe\nversion: 1\nschema:\n  dialect: json-schema-2020-12\n  value:\n    type: object\n    properties:\n      type: { const: probe }\n      source: { type: string }\n---\n");
      await mkdir(join(root, "annotations"), { recursive: true });
      await mkdir(join(root, "sources"), { recursive: true });
      await mkdir(join(root, "other"), { recursive: true });
      await mkdir(join(root, "notes"), { recursive: true });
      await writeFile(join(root, "notes/book.md"), "---\ntitle: Not a source\n---\n");
      const sources = ["sources/book.md", "sources/duplicate.md", "other/duplicate.md", "sources/plot.png.md"];
      const links = ["[[sources/book|Title]]", "[[../sources/book]]", "[[book]]", "[[duplicate]]", "[[plot.png]]"];
      for (const path of sources) await writeFile(join(root, path), "---\ntitle: Book\n---\n\nBody");
      for (let i = 0; i < links.length; i++) {
        const path = `annotations/${i}.md`, frontmatter = { type: "probe", source: links[i]!, extra: "retained" };
        authority.seed(path, { frontmatter, body: "> Quote" });
        await writeFile(join(root, path), `---\ntype: probe\nsource: '${links[i]}'\nextra: retained\n---\n\n> Quote`);
      }
      collection = (await Collection.open(root)).collection!;
      const operations = collection.v03Operations();
      const client = new MdbaseCollectionClient({ async operation<Result>(_op: string, input: unknown): Promise<Result> {
        return await operations.query(input as Parameters<typeof operations.query>[0]) as Result;
      } });
      const projection = await client.query({ types: ["probe"], where: 'file.inFolder("annotations")', projections: { target: { expression: "source" } }, select: ["projection.target"], frontmatterMode: "persisted" });
      expect(projection.ok).toBe(true);
      if (projection.ok) {
        expect(projection.value.results[0]).toMatchObject({ frontmatter: { extra: "retained" }, values: { target: links[0] } });
        expect(projection.value.results[0]).not.toHaveProperty("body");
      }
      const resolved = await client.query({ types: ["probe"], where: 'source.asFile().file.path == "sources/book.md"', includeBody: true });
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.value.results).toEqual([]);
        const native = await operations.query({ types: ["probe"], where: 'source.asFile().file.path == "sources/book.md"' });
        expect(JSON.stringify(native)).toContain("asFile");
      }
      // The record test authority owns sessions, not query semantics. Its own
      // snapshots retain raw relative/bare/aliased values; it cannot prove CEL parity.
      expect(authority.get("annotations/0.md")?.frontmatter["source"]).toBe(links[0]);
      expect("query" in authority).toBe(false);
      const index = new PathIndex(sources);
      expect(resolveLinkTarget("sources/book.md", "annotations/0.md", index)).toBe("sources/book.md");
      expect(resolveLinkTarget("../sources/book.md", "annotations/1.md", index)).toBe("sources/book.md");
      expect(resolveLinkTarget("book.md", "annotations/2.md", index)).toBe("sources/book.md");
      expect(resolveLinkTarget("duplicate.md", "annotations/3.md", index)).toBeNull();
      const resolver = new LinkResolver({ recordExtensions: [".md"] });
      const nativeTargets = links.map((link, i) => resolver.resolve(link, `annotations/${i}.md`, [...sources, "notes/book.md"]).resolved);
      expect(nativeTargets.slice(0, 3)).toEqual(["sources/book.md", "sources/book.md", "notes/book.md"]);
      // Native resolution is collection-wide and picks a shortest/lexical match;
      // Writer scopes annotation candidates to sources and rejects basename ambiguity.
      expect(nativeTargets[3]).toBe("other/duplicate.md");
      expect(nativeTargets[4]).toBe("sources/plot.png.md");
    } finally { authority.watch.close(); await collection?.close(); await rm(root, { recursive: true, force: true }); }
  });
});
