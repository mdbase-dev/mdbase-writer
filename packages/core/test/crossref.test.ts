import { describe, expect, it } from "vitest";

import { resolveCrossReferences } from "../src/index.js";

const doc = `# Intro {#sec-intro}

See @fig-site, [see @tbl-data; @eq-energy] and @sec-method; cite [@smith20, 4] and @smith20 as before.[^n]

[^n]: Also @fig-site.

![Site plan](media/site.svg){#fig-site width=60%}

| a | b |
|---|---|
| 1 | 2 |

: Data {#tbl-data}

$$E = mc^2$$ {#eq-energy}

# Aside {.unnumbered}

## Method {#sec-method}

\`@fig-site\` and a mail@fig-site.org stay.

![Unlabelled](media/x.png)
`;

describe("resolveCrossReferences", () => {
  const { markdown, targets } = resolveCrossReferences(doc, "en-US");

  it("numbers targets as the templates do", () => {
    expect(Object.fromEntries(targets)).toEqual({
      "sec-intro": { kind: "section", number: "1" },
      "fig-site": { kind: "figure", number: "1" },
      "tbl-data": { kind: "table", number: "1" },
      "eq-energy": { kind: "equation", number: "(1)" },
      // The unnumbered heading does not advance the count.
      "sec-method": { kind: "section", number: "1.1" },
    });
  });

  it("writes references as linked text, leaving citations, code and addresses alone", () => {
    expect(markdown).toContain("See [Figure 1](#fig-site), see [Table 1](#tbl-data), [Equation (1)](#eq-energy) and [Section 1.1](#sec-method);");
    expect(markdown).toContain("cite [@smith20, 4] and @smith20 as before.");
    expect(markdown).toContain("[^n]: Also [Figure 1](#fig-site).");
    expect(markdown).toContain("`@fig-site` and a mail@fig-site.org stay.");
  });

  it("writes section numbers into numbered headings", () => {
    expect(markdown).toMatch(/^# 1 Intro \{#sec-intro\}$/m);
    expect(markdown).toMatch(/^# Aside \{\.unnumbered\}$/m);
    expect(markdown).toMatch(/^## 1\.1 Method \{#sec-method\}$/m);
  });

  it("puts numbers in captions and equations, keeping their ids", () => {
    expect(markdown).toContain("![Figure 1: Site plan](media/site.svg){#fig-site width=60%}");
    expect(markdown).toContain(": [Table 1: Data]{#tbl-data}");
    expect(markdown).toContain("[$$E = mc^2 \\qquad (1)$$]{#eq-energy}");
    expect(markdown).toContain("![Unlabelled](media/x.png)");
  });

  it("uses the document language's words", () => {
    expect(resolveCrossReferences(doc, "de-DE").markdown).toContain("See [Abbildung 1](#fig-site)");
  });
});
