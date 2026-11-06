import { expect, it } from "vitest";
import { markdownParser } from "../src/markdown.js";

it("keeps citation and reference offsets inside footnote definitions", () => {
  const body = "A note[^a].\n\n[^a]: See [@darwin42, p. 12].\n    Compare @sec-earth.\n\nAfter.\n";
  const found: [string, string][] = [];
  markdownParser.parse(body).iterate({ enter(node) {
    if (["Citation", "AtReference"].includes(node.name)) found.push([node.name, body.slice(node.from, node.to)]);
  } });
  expect(found).toEqual([["Citation", "[@darwin42, p. 12]"], ["AtReference", "@sec-earth"]]);
});
