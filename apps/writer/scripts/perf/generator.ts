// Shared deterministic records for the opt-in Node benchmark and dev-only browser fixture.
import type { JsonObject } from "@mdbase-dev/sdk";
export const counts = { sources: 5_000, annotations: 30_000, comments: 3_000, notes: 20_000, manuscripts: 100, files: 5_000 };
export const main = "manuscripts/main.md";
const pad = (n: number) => String(n).padStart(5, "0");
// Leave room for the main record under the SDK's 64 retained-session limit.
const browserChapters = Array.from({ length: 60 }, (_, i) => `chapters/chapter-${pad(i)}.md`);
export function generateCollection(seed: (path: string, type: string, fm: JsonObject, body: string) => void, highlightsPerBook?: number, browser = false): string {
  const body = "# Main {#sec-main}\n\n" + Array.from({ length: 100 }, (_, i) => `${browser ? `## Section ${i} {#sec-${i}}\n\n` : ""}Paragraph ${i}: quoted passage ${i}. A sustained cited argument [@source${pad(i)}].\n\n`).join("");
  // Share the fixture's intentionally identical text instead of retaining one
  // flattened copy per seeded record. Cardinality/logical payloads are unchanged.
  // This is a fixture correction, not a real-collection memory optimisation.
  const sourceBody = "Source body not needed for citation.\n".repeat(60);
  const annotationBody = `> ${"A quotation with evidence from the source. ".repeat(8)}\n\n${"Private reading note. ".repeat(32)}\n`;
  const noteBody = "Ordinary collection note.\n".repeat(80);
  const commentBody = "A comment discussing the passage. ".repeat(16);
  const abstract = "Source metadata. ".repeat(40);
  const mainBody = browser ? `${body}${browserChapters.map(path => `![[${path}]]`).join("\n\n")}\n` : body;
  for (let i = 0; i < counts.manuscripts; i++) seed(i === 0 ? main : `manuscripts/paper-${pad(i)}.md`, "writer-manuscript", { title: `Paper ${pad(i)}`, csl: "apa", template: "article" }, i === 0 ? mainBody : body);
  if (browser) {
    for (const [i, path] of browserChapters.entries()) {
      const sections = Array.from({ length: 8 }, (_, section) => `### Section ${section + 1}\n\nEvidence in chapter ${i + 1}, section ${section + 1}, supports the manuscript's argument. Further analysis puts the result in context.`);
      seed(path, "note", { title: `Chapter ${i + 1}` }, `## Chapter ${i + 1}\n\n${sections.join("\n\n")}\n`);
    }
  }
  for (let i = 0; i < counts.sources; i++) seed(`sources/source${pad(i)}.md`, "reader-source", {
    title: `Synthetic source ${pad(i)}`,
    csl: { id: `source${pad(i)}`, type: "article-journal", title: `Synthetic research ${pad(i)}: evidence and collection performance`, author: [{ family: `Author${pad(i % 997)}`, given: "Alex" }], issued: { "date-parts": [[2000 + i % 25]] }, "container-title": "Journal of Synthetic Data", DOI: `10.0000/${i}`, abstract },
  }, sourceBody);
  for (let i = 0; i < counts.annotations; i++) seed(`annotations/highlight-${pad(i)}.md`, "reader-annotation", { source: `[[sources/source${pad(highlightsPerBook === undefined ? i % counts.sources : i < highlightsPerBook ? 0 : 1 + i % (counts.sources - 1))}]]`, locator: { label: `p. ${i % 300 + 1}` } }, annotationBody);
  for (let i = 0; i < counts.notes; i++) seed(`notes/note-${pad(i)}.md`, "note", { title: `Note ${pad(i)}`, tags: ["synthetic", "research"] }, noteBody);
  for (let i = 0; i < counts.comments; i++) seed(`comments/comment-${pad(i)}.md`, "comment", {
    document: i % 10 === 0 ? "[[manuscripts/main]]" : `[[notes/note-${pad(i % counts.notes)}]]`, created_at: "2026-01-01T00:00:00Z", status: browser ? "open" : i % 3 === 0 ? "resolved" : "open", motivation: "commenting", target: { quote: { exact: `quoted passage ${i % 100}` } },
    ...(browser && i > 0 && i % 10 === 0 && i < 1500 ? { in_reply_to: "[[comments/comment-00000]]" } : {}),
  }, commentBody);
  return body;
}
