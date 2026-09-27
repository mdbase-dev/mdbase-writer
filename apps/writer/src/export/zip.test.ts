import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { crc32, zip } from "./zip.js";

const hasUnzip = (() => {
  try {
    execFileSync("unzip", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("zip", () => {
  it("computes standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });

  it.skipIf(!hasUnzip)("produces an archive unzip can read, with UTF-8 names", () => {
    const bytes = zip([["manuscript.md", "# Tëst\n"], ["media/figures/a.bin", new Uint8Array([0, 1, 2, 255])]]);
    const path = join(mkdtempSync(join(tmpdir(), "writer-zip-")), "t.zip");
    writeFileSync(path, bytes);
    expect(execFileSync("unzip", ["-t", path], { encoding: "utf8" })).toMatch(/No errors detected/);
    expect(execFileSync("unzip", ["-p", path, "manuscript.md"], { encoding: "utf8" })).toBe("# Tëst\n");
  });
});
