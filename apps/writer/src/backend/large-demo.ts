// Imported only by the DEV ?demo=large branch. No account or production data.
import { counts, generateCollection } from "../../scripts/perf/generator.js";
import { createDemoApp, DemoWriterBackend, demoRecord } from "./demo-fixture.js";

export async function createLargeDemoBackend(chapters = 0, longChapter = false) {
  const records: ReturnType<typeof demoRecord>[] = [];
  generateCollection((path, type, fields, body) => records.push(demoRecord(path, { type, ...fields }, body)), 300, true, chapters, longChapter);
  const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>');
  const assets = new Map(Array.from({ length: counts.files }, (_, i) => [`files/image-${i}.png`, image]));
  return new DemoWriterBackend(await createDemoApp({ name: "Large demo", records }), assets, "large-demo");
}
