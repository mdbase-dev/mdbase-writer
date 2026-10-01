import { describe, expect, it } from "vitest";
import { IMAGE_EXTENSION, joinPath, dirname, PathIndex, resolveLinkTarget } from "../src/records.js";

// Frozen reference: the pre-index resolver, including exact case-sensitive precedence.
function oldResolve(target: string, fromPath: string, candidates: ReadonlySet<string>, extension = ".md"): string | null {
  const clean = decodeURI(target.trim()).replace(/^\.\//, "");
  const withExt = (p: string) => extension && !p.toLowerCase().endsWith(extension) && !IMAGE_EXTENSION.test(p) ? p + extension : p;
  const tries = [withExt(joinPath("", clean)), withExt(joinPath(dirname(fromPath), clean))];
  for (const t of tries) if (candidates.has(t)) return t;
  if (!clean.includes("/")) {
    const name = withExt(clean).toLowerCase();
    const matches = [...candidates].filter((c) => c.toLowerCase() === name || c.toLowerCase().endsWith(`/${name}`));
    if (matches.length === 1) return matches[0] ?? null;
  }
  return null;
}

describe("indexed path resolution", () => {
  it("preserves exact, relative, unique-basename, ambiguity and extension precedence", () => {
    const paths = ["a.md", "folder/a.md", "folder/A.md", "other/unique.MD", "figures/Plot.PNG", "École.md", "one/same.md", "two/SAME.md", "x/foo/bar", "empty/"];
    const index = new PathIndex(paths);
    for (const target of ["a", "A", "unique", "same", "Plot.PNG", " École ", "../a", "/a", "./a", "folder/../a", "folder/a", "missing", "", ".", "..", "foo"])
      for (const extension of [".md", "", ".MD", ".typ", "/bar"])
        expect(resolveLinkTarget(target, "folder/main.md", index, extension), `${target} ${extension}`).toBe(oldResolve(target, "folder/main.md", new Set(paths), extension));
    expect(resolveLinkTarget("a", "folder/main.md", index)).toBe("a.md");
    expect(resolveLinkTarget("same", "main.md", index)).toBeNull();
    expect(resolveLinkTarget("unique", "main.md", index)).toBe("other/unique.MD");
    expect(resolveLinkTarget("%C3%89cole", "main.md", index)).toBe("École.md");
    expect(() => resolveLinkTarget("%XX", "main.md", index)).toThrow(URIError);
    expect([...index]).toEqual(paths);
    expect(index.size).toBe(paths.length);
  });

  it("matches the old implementation over deterministic generated collections and links", () => {
    let seed = 7919;
    const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const pick = <T>(values: T[]): T => values[Math.floor(random() * values.length)]!;
    const names = ["alpha", "Alpha", "école", "ÉCOLE", "😀", "space name", "a.b", "empty", "same", "SAME"];
    const extensions = [".md", ".MD", ".png", ".typ", ""];
    for (let collection = 0; collection < 150; collection++) {
      const paths = new Set(Array.from({ length: 30 }, () => pick(["", "one/", "two/", "one/deep/"]) + pick(names) + pick(extensions)));
      const index = new PathIndex(paths);
      for (let link = 0; link < 50; link++) {
        const name = pick(names) + pick(extensions);
        const target = pick([name, `../${name}`, `./${name}`, `one/${name}`, `/${name}`, ` ${encodeURI(name)} `]);
        const from = pick(["main.md", "one/main.md", "one/deep/main.md", "elsewhere/record.md"]);
        const extension = pick([".md", "", ".typ"]);
        expect(resolveLinkTarget(target, from, index, extension), `${collection}: ${target} from ${from}`).toBe(oldResolve(target, from, paths, extension));
      }
    }
  });

  it("keeps collection generations independent", () => {
    const before = new PathIndex(["one/a.md"]);
    const after = new PathIndex(["one/a.md", "two/a.md"]);
    expect(resolveLinkTarget("a", "main.md", before)).toBe("one/a.md");
    expect(resolveLinkTarget("a", "main.md", after)).toBeNull();
    expect(resolveLinkTarget("one/a", "main.md", after)).toBe("one/a.md");
  });
});
