# Large collection benchmark (opt-in, local only)

From the repository root:

```sh
pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
rpnpm --filter @mdbase-writer/app typecheck:perf
pnpm -C apps/writer typecheck
```

The registered smoke check runs one zero-latency fixture with `rpnpm --filter @mdbase-writer/app test:perf-fixture`.

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

Start the normal development server, then visit `http://127.0.0.1:5320/?demo=large&manuscript=manuscripts/main.md`. This mode shares `generator.ts` with the Node benchmark; it adds 100 labelled headings, 300 highlights on one source and one 149-reply thread. It uses NativeWriterBackend, SDK sessions, compiler and renderer over an in-memory SDK fixture. It is DEV-only, even for a production demo build.

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

The script also captures editor/preview visible geometry at animation frames, CDP main-isolate JS heap, >50 ms main-thread long tasks during two ~10 s typing phases, source paging (historically Show all), 300-highlight expansion, citation/embed completion, page errors and `out/large-{sources,comments}-{before,after}.png`. One run is observational, not a statistical timing assertion; the main heap field excludes workers/native backing storage, and visible canvas is not pixel verification. The original Round 4 heap field was not GC-controlled. The default JSON output is `out/perf/browser-profile.json`. Historical before was captured before Round 4 UI changes; after uses a corrected reply counter. Interpretation and deferred work are in `docs/perf-review.md`.
