// Explicit development/LAB fixture. Collection operations use NativeWriterBackend.
import type { JsonObject } from "@mdbase-dev/sdk";
import type { CslItem } from "@mdbase-writer/core";
import { splitFrontmatter } from "@mdbase-writer/core/records";
import { createDemoApp, DemoWriterBackend, demoRecord } from "./demo-fixture.js";
import { bodySummary, ok } from "./types.js";

const markdown = import.meta.glob("../../demo/**/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const assets = import.meta.glob("../../demo/**/*.{svg,png,jpg}", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const relative = (key: string) => key.replace(/^\.\.\/\.\.\/demo\//, "");

class SampleWriterBackend extends DemoWriterBackend {
  private readonly lastWritten = new Map<string, { body: string; modified: string }>();
  override async listManuscripts() {
    const result = await super.listManuscripts();
    if (!result.ok) return result;
    const manuscripts = await Promise.all(result.value.map(async manuscript => {
      const record = await this.fixture.client().get({ path: manuscript.path }, { include: { body: true } });
      const body = record.body ?? "";
      let written = this.lastWritten.get(manuscript.path);
      if (!written || written.body !== body) {
        written = { body, modified: new Date(Date.now() - (written ? 0 : (this.lastWritten.size * 4 + 2) * 86_400_000)).toISOString() };
        this.lastWritten.set(manuscript.path, written);
      }
      return { ...manuscript, ...bodySummary(body), modified: written.modified };
    }));
    return ok(manuscripts);
  }
}

export async function createDemoBackend() {
  const records = new Map(Object.entries(markdown).map(([key, text]) => {
    const { body, frontmatter } = splitFrontmatter(text);
    return [relative(key), demoRecord(relative(key), frontmatter as JsonObject, body)];
  }));
  const library = (await import("../../demo/library.json")).default as CslItem[];
  for (const item of library) {
    const path = `sources/${item.id}.md`, existing = records.get(path);
    records.set(path, demoRecord(path, { ...existing?.frontmatter, type: "reader-source", csl: item as JsonObject }, existing?.body ?? ""));
  }
  // Match the fake account createTestApp supplies, so demo comments keep their author.
  const author = records.get("people/Jordan Ellis.md");
  if (!author) throw new Error("Missing demo author");
  author.frontmatter["identities"] = [{ issuer: "https://connect.test", subject: "person-0" }];
  return new SampleWriterBackend(await createDemoApp({ name: "Demo collection", records: [...records.values()] }), new Map(Object.entries(assets).map(([key, url]) => [relative(key), url])), "demo");
}
