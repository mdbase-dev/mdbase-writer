import { CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import type { LibraryEntry } from "../backend/types.js";
import { writerCompletions } from "./completions.js";

const entry = (key: string, title: string): LibraryEntry => ({
  key,
  title,
  path: `sources/${key}.md`,
  item: { id: key, title, author: [{ family: "Agamben" }], issued: { "date-parts": [[1999]] } },
});
const source = writerCompletions(() => ({
  library: [entry("agambenBartleby99", "Bartleby, or On Contingency"), entry("agambenPotentialities99", "Potentialities: Collected Essays")],
  labels: ["sec-agamben"],
  recordPaths: [],
  cited: new Set(["agambenPotentialities99"]),
}));
const complete = (doc: string) => {
  const state = EditorState.create({ doc });
  return source(new CompletionContext(state, doc.length, false)) as CompletionResult;
};

describe("citation completion", () => {
  it("offers sources first in brackets, cited ones first, with their titles", () => {
    const options = complete("As argued [@ag").options;
    expect(options.map((o) => o.label)).toEqual(["agambenPotentialities99", "agambenBartleby99", "sec-agamben"]);
    expect(options[1]?.detail).toBe("Agamben, 1999 · Bartleby, or On Contingency");
  });

  it("offers cross-references first after a bare @", () => {
    expect(complete("See @ag").options[0]?.label).toBe("sec-agamben");
  });
});
