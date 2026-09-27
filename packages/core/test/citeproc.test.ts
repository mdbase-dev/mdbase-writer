import { describe, expect, it } from "vitest";

import { Citeproc, parseCiteItem, type CitationRequest, type CiteItem } from "../src/index.js";
import { loadLibrary, loadStyles, locales } from "./helpers.js";

const styles = loadStyles();
const library = loadLibrary();
const KEYS = ["badiouBeing07", "badioucentury07", "badiouconcept07", "agambenPotentialities99", "agambenBartleby99", "allenWhy10", "allenPower10", "debeauvoirPrime65", "arrietaexplainable2019", "jamisonRigveda14"];

function item(key: string, locator?: string): CiteItem {
  const parsed = parseCiteItem(`@${key}${locator ? `, ${locator}` : ""}`);
  if (!parsed) throw new Error(key);
  return parsed;
}

/** Deterministic pseudo-random numbers so failures reproduce. */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
}

function renumber(clusters: CiteItem[][], note: boolean): CitationRequest[] {
  return clusters.map((items, i) => ({ items, noteIndex: note ? i + 1 : 0 }));
}

describe.each(["chicago-notes-bibliography", "apa", "ieee"])("incremental citeproc (%s)", (style) => {
  it("matches a full rebuild after every single-cluster edit", () => {
    const random = rng(style.length * 7919);
    const pick = () => KEYS[Math.floor(random() * KEYS.length)] ?? "badiouBeing07";
    const note = style.includes("notes");
    let clusters: CiteItem[][] = Array.from({ length: 12 }, () => [item(pick(), random() < 0.5 ? String(1 + Math.floor(random() * 300)) : undefined)]);
    const incremental = new Citeproc(styles.get(style) ?? "", locales, library);
    // rebuildProcessorState resets all processor state, so a second engine
    // forced to rebuild every time is an exact reference.
    const reference = new Citeproc(styles.get(style) ?? "", locales, library);
    incremental.process(renumber(clusters, note));
    const modes = new Set<string>();
    for (let step = 0; step < 40; step++) {
      const at = Math.floor(random() * (clusters.length + 1));
      const r = random();
      if (r < 0.45) clusters.splice(at, 0, [item(pick(), String(1 + Math.floor(random() * 50)))]);
      else if (r < 0.8 && clusters.length) clusters[Math.min(at, clusters.length - 1)] = [item(pick())];
      else if (clusters.length > 1) clusters.splice(Math.min(at, clusters.length - 1), 1);
      clusters = [...clusters];
      const requests = renumber(clusters, note);
      const got = incremental.process(requests);
      modes.add(got.mode);
      const expected = reference.process(requests, { forceRebuild: true });
      expect(got.strings, `step ${step}`).toEqual(expected.strings);
      expect(got.bibliography.entries.map((e) => e.key)).toEqual(expected.bibliography.entries.map((e) => e.key));
      expect(got.bibliography.entries).toEqual(expected.bibliography.entries);
    }
    expect(modes).toContain("incremental");
  }, 60_000);
});

describe("citeproc performance", () => {
  it("updates one cluster in a 1,000-cluster note-style document quickly", () => {
    const cp = new Citeproc(styles.get("chicago-notes-bibliography") ?? "", locales, library);
    const clusters = Array.from({ length: 1000 }, (_, i) => [item(KEYS[i % KEYS.length] ?? "badiouBeing07", String((i % 90) + 1))]);
    const full = cp.process(renumber(clusters, true));
    expect(full.mode).toBe("rebuild");
    clusters[500] = [item("allenPower10", "7")];
    const edit = cp.process(renumber(clusters, true));
    expect(edit.mode).toBe("incremental");
    expect(edit.ms).toBeLessThan(full.ms / 5);
    const typing = cp.process(renumber(clusters, true));
    expect(typing.mode).toBe("cached");
  }, 60_000);
});
