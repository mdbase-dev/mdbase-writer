import { describe, expect, it } from "vitest";

import { equationSnippet, figureSnippet, nextFootnoteId, tableSnippet, uniqueLabel } from "./snippets.js";

describe("insert snippets", () => {
  it("labels a figure after its file and selects the caption", () => {
    const s = figureSnippet("figures/Reef Stages.png", new Set());
    expect(s.text).toBe("![Caption](figures/Reef Stages.png){#fig-reef-stages}");
    expect(s.text.slice(s.select[0], s.select[1])).toBe("Caption");
  });
  it("numbers a label that is already taken", () => {
    expect(uniqueLabel("fig-reef", new Set(["fig-reef", "fig-reef-2"]))).toBe("fig-reef-3");
    expect(tableSnippet(new Set(["tbl-table"])).text).toContain("{#tbl-table-2}");
    expect(equationSnippet(new Set()).text).toMatch(/^\$\$\n.*\n\$\$ \{#eq-equation\}$/s);
  });
  it("gives the next footnote the number after the highest in the text", () => {
    expect(nextFootnoteId("")).toBe("1");
    expect(nextFootnoteId("a[^1] b[^3]\n\n[^1]: x\n[^3]: y\n[^note]: z")).toBe("4");
  });
});
