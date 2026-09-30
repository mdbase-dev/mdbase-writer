import { describe, expect, it } from "vitest";

import { appendEmbed, chapterEmbeds, moveEmbed } from "./chapters.js";

describe("chapter embeds", () => {
  const body = "# Book\n\n![[chapters/one]]\n\nA bridge.\n\n![[chapters/two|Two]]\n\n![[chapters/three#Start]]\n\nSee ![[inline]].\n";

  it("lists embeds on lines of their own, without section or alias", () => {
    expect(chapterEmbeds(body).map((e) => e.target)).toEqual(["chapters/one", "chapters/two", "chapters/three"]);
  });

  it("moves an embed and leaves the text between embeds in place", () => {
    expect(moveEmbed(body, 2, 0)).toBe("# Book\n\n![[chapters/three#Start]]\n\nA bridge.\n\n![[chapters/one]]\n\n![[chapters/two|Two]]\n\nSee ![[inline]].\n");
    expect(moveEmbed(body, 0, 5)).toBe(body);
  });

  it("appends after the last chapter, spaced as the chapters are", () => {
    expect(appendEmbed(body, "chapters/four")).toContain("![[chapters/three#Start]]\n\n![[chapters/four]]\n\nSee");
    expect(appendEmbed("![[a]]\n![[b]]\n", "c")).toBe("![[a]]\n![[b]]\n![[c]]\n");
    expect(appendEmbed("# Book\n\nText.\n\n", "c")).toBe("# Book\n\nText.\n\n![[c]]\n");
    expect(appendEmbed("", "c")).toBe("![[c]]\n");
  });

  it("leaves out embeds that are not chapters (quotations)", () => {
    const quoted = "![[one]]\n\n![[notes/quote]]\n\n![[two]]\n";
    const isChapter = (t: string) => !t.startsWith("notes/");
    expect(chapterEmbeds(quoted, isChapter).map((e) => e.target)).toEqual(["one", "two"]);
    expect(moveEmbed(quoted, 1, 0, isChapter)).toBe("![[two]]\n\n![[notes/quote]]\n\n![[one]]\n");
    expect(appendEmbed("![[one]]\n\n![[notes/quote]]\n", "two", isChapter)).toBe("![[one]]\n\n![[two]]\n\n![[notes/quote]]\n");
  });
});
