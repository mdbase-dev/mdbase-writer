import { describe, expect, it } from "vitest";

import { markAt, sourceMarks, type RawMark } from "./marks.js";

const at = (page: number, y: number) => ({ page, y: `${y}pt` });

describe("source marks in the preview", () => {
  const marks = sourceMarks([
    [["note", "manuscripts/a.md", 120, ["agamben99", "badiou07"]], at(1, 700)],
    [["end"], at(1, 700)],
    [["entry", "agamben99"], at(4, 100)],
    [["end"], at(4, 124)],
    [["entry", "badiou07"], at(4, 140)],
    [["end"], at(5, 60)],
  ] as RawMark[]);

  it("pairs each opening marker with its end", () => {
    expect(marks).toEqual([
      { kind: "note", keys: ["agamben99", "badiou07"], record: "manuscripts/a.md", offset: 120, page: 1, top: 700, bottom: 711 },
      { kind: "entry", keys: ["agamben99"], page: 4, top: 100, bottom: 135 },
      { kind: "entry", keys: ["badiou07"], page: 4, top: 140, bottom: Number.POSITIVE_INFINITY },
    ]);
  });

  it("finds the passage under a point", () => {
    expect(markAt(marks, 4, 130)?.keys).toEqual(["agamben99"]);
    expect(markAt(marks, 4, 137)).toBeUndefined();
    expect(markAt(marks, 1, 705)?.kind).toBe("note");
    expect(markAt(marks, 2, 705)).toBeUndefined();
  });
});
