import { describe, expect, it } from "vitest";

import { searchManuscript } from "./search.js";

const bodies: Record<string, string> = {
  "main.md": "# Introduction\n\nPotentiality is not actuality.\n\n![[one]]\n",
  "one.md": "In the chapter, potentiality returns; so does POTENTIALITY.\n",
  "two.md": "Nothing here.\n",
};
const search = (query: string, limit?: number) => searchManuscript(query, ["main.md", "one.md", "two.md"], (r) => bodies[r], limit);

describe("searching a manuscript", () => {
  it("finds matches in every record, in reading order, ignoring case", () => {
    const result = search("potentiality");
    expect(result.total).toBe(3);
    expect(result.groups.map((g) => [g.record, g.hits.length])).toEqual([["main.md", 1], ["one.md", 2]]);
    const [hit] = result.groups[1]?.hits ?? [];
    expect(bodies["one.md"]?.slice(hit?.from, hit?.to)).toBe("potentiality");
  });

  it("shows each match in its line", () => {
    const hit = search("returns").groups[0]?.hits[0];
    expect([hit?.before, hit?.match, hit?.after]).toEqual(["…the chapter, potentiality ", "returns", "; so does POTENTIALITY."]);
  });

  it("treats the query as text, and any run of spaces as whitespace", () => {
    expect(search("[[one]]").total).toBe(1);
    expect(search("is   not").total).toBe(1);
    expect(search("   ").groups).toEqual([]);
  });

  it("counts every match but lists only up to the limit", () => {
    const result = search("potentiality", 2);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(true);
    expect(result.groups.flatMap((g) => g.hits)).toHaveLength(2);
  });
});
