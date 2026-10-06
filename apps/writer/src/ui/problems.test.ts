import { describe, expect, it } from "vitest";

import type { WriterDiagnostic } from "../compile/protocol.js";
import { problemRows } from "./ProblemsStrip.js";

const d = (record: string, from: number, extra: Partial<WriterDiagnostic> = {}): WriterDiagnostic => ({ record, from, to: from, severity: "error", message: "m", origin: "writer", ...extra });

describe("problem rows", () => {
  const bodies: Record<string, string> = { "main.md": "# Title\n\nOne\nTwo\n", "ch/one.md": "# One\n\nText" };
  const body = (p: string) => bodies[p];
  const title = (p: string) => (p === "main.md" ? "Main" : "Chapter one");
  it("orders settings first, then records in reading order, with their lines", () => {
    const rows = problemRows([d("ch/one.md", 8), d("main.md", 13), d("main.md", 0), d("main.md", 0, { field: "title" })], ["main.md", "ch/one.md"], body, title);
    expect(rows.map((r) => r.where)).toEqual(["Settings · title", "Main · line 1", "Main · line 4", "Chapter one · line 3"]);
  });
  it("names only the line in a single-record manuscript", () => {
    expect(problemRows([d("main.md", 9)], ["main.md"], body, title)[0]?.where).toBe("Line 3");
  });
});
