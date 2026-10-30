// Opt-in Node proxy timings, not browser paint or production acceptance.
// Run: pnpm exec vitest run --config scripts/perf/vitest.config.ts
// Uses the retained SDK + Writer backend, never a synthetic legacy query client.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { expect, it, vi } from "vitest";
import { createMemoryWriter, seedDemoRecord } from "../../src/backend/demo.js";
import { counts, generateCollection, main } from "./generator.js";

const runs = Number(process.env["PERF_RUNS"] ?? 1);
const latencyMs = Number(process.env["PERF_LATENCY_MS"] ?? 20);
if (!Number.isInteger(runs) || runs < 1 || !Number.isFinite(latencyMs) || latencyMs < 0) throw new Error("Invalid benchmark settings");
it("large collection SDK baseline (opt-in)", async () => {
  const results = [];
  for (let run = 0; run < runs; run++) {
    const started = performance.now();
    const backend = await createMemoryWriter(replica => generateCollection((path, type, fields, body) => seedDemoRecord(replica, path, {type, ...fields}, body)));
    const seedMs = performance.now() - started;
    const transfers: {operation: string; bytes: number}[] = [];
    const methods = ["query", "queryContract", "get"] as const;
    for (const method of methods) {
      const original = backend.sdkClient[method].bind(backend.sdkClient);
      // Public SDK methods are only instrumented for latency/size; query
      // semantics, pagination, contract projections and sessions stay SDK-owned.
      vi.spyOn(backend.sdkClient, method).mockImplementation((async (...args: unknown[]) => {
        if (latencyMs) await new Promise(resolve => setTimeout(resolve, latencyMs));
        const result = await (original as (...args: unknown[]) => Promise<unknown>)(...args);
        transfers.push({operation: method, bytes: Buffer.byteLength(JSON.stringify(result, (_key, value) => value instanceof Map ? Object.fromEntries(value) : value))});
        return result;
      }) as typeof backend.sdkClient[typeof method]);
    }
    try {
      const home = performance.now();
      const [index, library, manuscripts] = await Promise.all([backend.index(), backend.library(), backend.listManuscripts()]);
      expect(index.ok && index.value.recordPaths.length).toBeGreaterThan(counts.notes);
      expect(library.ok && library.value.length).toBe(counts.sources);
      expect(manuscripts.ok && manuscripts.value.length).toBe(counts.manuscripts);
      const homeMs = performance.now() - home;
      const opening = performance.now();
      const lease = await backend.records.open(main, {autosave: false});
      expect(lease.ok).toBe(true);
      if (lease.ok) lease.value.release();
      const openMs = performance.now() - opening;
      const read = performance.now();
      const annotations = await backend.annotationsForSource("sources/source00000.md");
      expect(annotations.ok && annotations.value.length).toBe(counts.annotations / counts.sources);
      const annotationsMs = performance.now() - read;
      const refresh = performance.now();
      backend.replica.editElsewhere("notes/note-00000.md", {body: "Changed in another app"});
      await backend.reconcile();
      results.push({run: run + 1, seedMs, homeMs, openMs, annotationsMs, refreshMs: performance.now() - refresh, transfers});
    } finally {backend.dispose(); vi.restoreAllMocks();}
  }
  const report = {environment: {node: process.version, cpu: cpus()[0]?.model}, counts: {...counts, files: 0}, latencyMs, runs, results};
  const destination = process.env["PERF_OUTPUT"] ?? "out/perf/large-collection.json";
  mkdirSync(dirname(destination), {recursive: true});
  writeFileSync(destination, JSON.stringify(report, null, 2) + "\n");
});
