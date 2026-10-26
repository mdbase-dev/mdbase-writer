import { expect, it } from "vitest";
import { materialize, translateRecord, lintMath } from "@mdbase-writer/core";
import { diagnosticMessage } from "./diagnostics.js";

it("carries serializable guidance across the worker boundary, without changing default English diagnostics", () => {
  const diagnostic = translateRecord("A missing footnote[^東京].").diagnostics[0]!;
  const received = structuredClone(diagnostic);
  expect(received.copy).toEqual({ code: "footnote-missing", values: ["東京"] });
  expect(diagnosticMessage(received.message, received.copy)).toBe("Footnote [^東京] has no definition.");
  expect(diagnostic.message).toBe("Footnote [^東京] has no definition.");
});

it("preserves LaTeX syntax and does not expose literal braces as ICU placeholders", () => {
  const problem = lintMath("\\begin{pmatrix} x \\end{bmatrix}")[0]!;
  expect(diagnosticMessage(`Math: ${problem.message}`, problem.copy)).toBe("Math: \\end{bmatrix} closes \\begin{pmatrix}.");
  expect(diagnosticMessage("", { code: "math-env-unclosed", values: ["pmatrix"] })).toBe("Math: \\begin{pmatrix} is never closed.");
});

it("does not translate raw Typst or authority diagnostics", () => {
  const raw = "Typst: unknown variable: café";
  expect(diagnosticMessage(raw)).toBe(raw);
});

it("formats export warnings only, never manuscript content, metadata, paths or generated bibliography", () => {
  const input = {
    main: "drafts/東京.md",
    records: new Map([["drafts/東京.md", { path: "drafts/東京.md", body: "# Mon manuscrit\n\n![[missing]]", frontmatter: { title: "Mon manuscrit", lang: "fr" } }]]),
    recordPaths: new Set(["drafts/東京.md"]), filePaths: new Set<string>(), library: new Map(), styles: new Map(),
  };
  const english = materialize(input);
  const presented = materialize({ ...input, formatProblem: (_message, copy) => `warning:${copy?.code}` });
  expect(presented.problems).toEqual(["warning:embed-omitted"]);
  expect(english.problems[0]).toContain("missing");
  expect({ ...presented, problems: [] }).toEqual({ ...english, problems: [] });
});
