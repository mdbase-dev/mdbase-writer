// DEV ?demo=large: same SDK backend with a larger synthetic fixture.
import { generateCollection } from "../../scripts/perf/generator.js";
import { createMemoryWriter, seedDemoRecord } from "./demo.js";

export function createLargeDemoBackend() {
  return createMemoryWriter(replica => {
    generateCollection((path, type, fields, body) => seedDemoRecord(replica, path, {type, ...fields}, body), 300, true);
  });
}
