# Large collection benchmark (opt-in, local only)

From the repository root:

```sh
pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
rpnpm --filter @mdbase-writer/app typecheck:perf
pnpm -C apps/writer typecheck
```

Run both benchmarks with `rpnpm --filter @mdbase-writer/app test:perf-fixture`. This uses one zero-latency run of the collection fixture.

Run just the mounted outline benchmark from the repository root:

```sh
rpnpm --filter @mdbase-writer/app run test:perf-fixture scripts/perf/outline.bench.tsx
```

It renders all 120 chapter rows through the normal outline pagination, edits one chapter, and switches among four loaded chapters. It checks section words and searches for one sparse term and one broad term across the same manuscript. Each phase has 5 warmups and 20 measurements. The fixture has 24 headings and three comment offsets per chapter. Outline timings include React commits in jsdom.

For a control at `ba47bda`, create a detached worktree and copy these files from the performance branch before running the same commands. Start the dev server from that worktree for the Chromium comparison.

```text
apps/writer/package.json
apps/writer/scripts/perf/browser-profile.mjs
apps/writer/scripts/perf/generator.ts
apps/writer/scripts/perf/outline.bench.tsx
apps/writer/scripts/perf/tsconfig.json
apps/writer/scripts/perf/vitest.config.ts
apps/writer/src/backend/large-demo.ts
apps/writer/src/ui/DemoRoot.tsx
```

Capture JSON (output path is relative to `apps/writer`):

```sh
PERF_OUTPUT=out/perf/result.json pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
PERF_RUNS=1 PERF_LATENCY_MS=0 PERF_OUTPUT=out/perf/control.json pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
```

Defaults: three independently seeded runs, 20 ms per measured SDK response, 500 binary descriptors per file page. Override `PERF_RUNS`, `PERF_LATENCY_MS` and `PERF_FILE_PAGE_SIZE`.

The deterministic collection has 5,000 sources, 30,000 annotations, 3,000 comments, 20,000 notes, 100 manuscripts (58,100 Markdown records), and 5,000 binary files. Source CSL includes a ~680-character abstract, annotation bodies ~1 KiB, comment bodies ~0.5 KiB. Notes/source bodies are seeded but not bulk transferred. 300 comments belong to the main record; the remainder belong to other notes.

## What runs

- Real `NativeWriterBackend`, `ManuscriptWorkspace`, SDK sessions and contract queries over `createTestApp` / `MemoryReplica` from `@mdbase-dev/sdk/testing`.
- The same 58,100 generated records and 5,000 files. File uploads seed the in-memory replica before measured startup.
- SDK read methods are timed and their plain JSON response sizes counted. `PERF_LATENCY_MS` adds a synthetic pause to each measured response; it does not model a network or a native query engine.
- Real search, completion, comment placement/threading and component server rendering. A compiler stub counts message sizes and structured cloning without Typst, fonts, WASM, preview rendering or exports.
- An additional fixture puts 300 annotations on one source and delays its contract query responses sixfold.

The current backend reads one complete native metadata snapshot and invalidates it on collection changes. Legacy incremental-query, capability-probe and batch-transport measurements below are historical and are not directly comparable with this SDK fixture. `PERF_AUTHORITY_FEATURES` and `PERF_STRICT_CONTRACTS` no longer apply.

Readiness/content assertions fail the run rather than emit a successful baseline with missing records. Times are Node proxies, not browser paint or runtime acceptance. Transfer sizes are logical JSON response bytes, not encrypted/compressed wire bytes. The benchmark does not plan queries, merge writes or validate contracts.

Result JSON is generated evidence: the default is `out/perf/large-collection.json` (gitignored). The scripts/config are outside normal test discovery; `generator.ts` is shared with the DEV-only large browser demo and compiled out of ordinary deployment builds.

## Recorded outcomes

Outline comparison on the remote builder (AMD EPYC 9B14, Node 22.22.0). Both runs used the same outline benchmark, with Writer at `ba47bda` for the baseline:

| Operation | Before p50 / p95 | After p50 / p95 |
|---|---:|---:|
| Typing in one chapter | 21.83 / 26.34 ms | 16.76 / 19.00 ms |
| Switching chapters | 23.75 / 53.00 ms | 18.70 / 19.30 ms |
| Sparse manuscript search (1 hit) | 1.31 / 1.34 ms | 1.30 / 1.33 ms |
| Broad manuscript search (34,560 hits) | 2.46 / 3.16 ms | 2.36 / 2.75 ms |

In one zero-latency collection run, warm search over 5,000 sources took 0.73 ms median, and resolving paths for 100 chapter embeds took 0.25 ms median. Cached placement of 300 comments took 0.03 ms, cold placement across 3,000 comments took 10.06 ms, and server rendering the Comments panel took 24.78 ms. Scanning 100 records from scratch for words, labels, and citations took 21.85 ms. Writer already tracks those manuscript totals by changed body. The outline change reuses heading parses and section counts across edits and chapter switches.

Round 3, three-run 20 ms medians (before → after):

| Metric | Before | After |
|---|---:|---:|
| Warm worker initialization | 1,669 ms | 55 ms |
| Unrelated-note publication | 3,600 ms | 75 ms |
| New source visible | 2,180 ms | 109 ms |
| Return Home backend calls | 1,565 ms | <1 ms |
| Unrelated-note traffic | 80 responses / 29,236,578 B | 1 / 357 B |
| Home → workspace → Home | 264 / 90,546,721 B | 113 / 36,006,846 B |
| Comment bodies | 3,000 / 1,632,000 B | 300 / 163,200 B |

Round 1 cold editing took 1,619 ms; independent editing in Round 2 took 38 ms. Resolving 3,000 bare comment links fell from 13,494 ms to 10.6 ms. The final Round 2 300-highlight batch took 66 ms instead of 1,557 ms, with one response instead of 300.

Round 4 Chromium: Comments typing fell from **39 long tasks / 2,947 ms** to **zero**. Sources expansion's 633 ms task and embed completion's two tasks disappeared. The comparison intentionally mounts less work: 120 rather than 5,000 sources, 50 rather than 300 highlights, and 50 threads + 50 replies. One cold sample had editor/preview geometry at 1,369/3,584 ms and main-isolate heap 274,179,084 B; these are not controlled cold-start/memory improvement claims.

Round 5 keeps the incremental traffic totals above, selected-body batching and warm worker initialization. The transport-independent collection store adds cold metadata classification; see `docs/perf-review.md` for fresh before/after observations, SDK capability evidence and line counts.

## Chromium responsiveness profile (Round 4)

Start the normal development server, then visit `http://127.0.0.1:5320/?demo=large&largeManuscript=1&manuscript=manuscripts/main.md`. This mode shares `generator.ts` with the Node benchmark. The Chromium fixture adds 60 embedded chapters, 100 labelled main-record headings, 300 highlights on one source and one 149-reply thread. It uses NativeWriterBackend, SDK sessions, compiler and renderer over an in-memory SDK fixture. It is DEV-only, even for a production demo build.

A 120-chapter attempt with SDK 0.2.58 opened the main record and 63 chapters. The SDK refused the other 57 with `record_session_budget` because Writer retains a session for each embedded chapter. The browser fixture uses 60 chapters so it can exercise the complete manuscript. The 120-chapter outline benchmark supplies record views directly.

```sh
PROFILE_NAME=after PROFILE_OUTPUT=out/perf/browser-after.json pnpm -C apps/writer exec node scripts/perf/browser-profile.mjs
pnpm -C apps/writer test:browser
```

`BASE`, `CHROME`, `PROFILE_NAME`, `PROFILE_OUTPUT` are configurable.
HTTP cache is explicitly disabled and service workers bypassed on every profile.
The profiler now also captures startup tasks, first drawn-revision time, worker
messages/resource timings, main heap after forced GC/full discovery and worker
heap usage. `PROFILE_CPU=out/perf/main.cpuprofile`,
`PROFILE_HEAP=out/perf/main.heapsnapshot`, and
`PROFILE_WORKER_HEAP=out/perf/worker` optionally save detailed evidence.
Summarise a snapshot with:

```sh
pnpm -C apps/writer exec node scripts/perf/heap-summary.mjs out/perf/main.heapsnapshot > apps/writer/out/perf/heap-summary.json
COLD_CACHE=1 pnpm -C apps/writer test:browser
```

On the fixture-corrected product comparison, cold preview went from 3,426 to
2,134 ms and the GC-controlled main heap from 60.91 to 58.28 MiB.
Uncollected heap is still recorded for historical comparisons, not treated as a
retention measurement.

The script captures editor and preview geometry at animation frames, CDP main-isolate JS heap, and main-thread tasks over 50 ms. It measures chapter switching, typing the same text with Outline, Sources and Comments open, sparse and broad outline search, source filtering and paging, highlight expansion, citation and embed completion, and Word export. It checks the finished edits, search result counts, and the presence of a Word document part in the downloaded DOCX. Browser action timings include Playwright round trips. Each typing phase uses 12 text inputs with no added delay. One Chromium run per revision is observational. The main heap excludes workers and native backing storage. The default JSON output is `out/perf/browser-profile.json`. The original Round 4 heap field was not GC-controlled. Interpretation of the earlier runs is in `docs/perf-review.md`.
