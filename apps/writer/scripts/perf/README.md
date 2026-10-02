# Large collection benchmark (opt-in, local only)

From the repository root:

```sh
pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
pnpm -C apps/writer exec tsc -p scripts/perf/tsconfig.json
pnpm -C apps/writer typecheck
```

Capture JSON (output path is relative to `apps/writer`):

```sh
PERF_OUTPUT=out/perf/result.json pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
PERF_RUNS=1 PERF_LATENCY_MS=0 PERF_OUTPUT=out/perf/control.json pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
PERF_AUTHORITY_FEATURES=0 PERF_OUTPUT=out/perf/legacy.json pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
```

Defaults: three independently seeded runs, 20 ms per query/describe/open/people/file-page response, 500 binary descriptors per file page. Override `PERF_RUNS`, `PERF_LATENCY_MS`, `PERF_FILE_PAGE_SIZE`. `PERF_STRICT_CONTRACTS=0` allows body-bearing contract queries for comparison with a permissive authority; default enforces the installed SDK's documented contract-query restrictions. Round 1's rejected cursor capability probe was retried by real SDK pagination before the type fallback. Round 2 no longer issues body-bearing contract queries.

The deterministic collection has 5,000 sources, 30,000 annotations, 3,000 comments, 20,000 notes, 100 manuscripts (58,100 Markdown records), and 5,000 binary files. Source CSL includes a ~680-character abstract, annotation bodies ~1 KiB, comment bodies ~0.5 KiB. Notes/source bodies are seeded but not bulk transferred. 300 comments belong to the main record; the remainder belong to other notes.

## What runs

- Real `ConnectBackend`, real `ManuscriptWorkspace` startup and watch-triggered refresh.
- Real SDK `queryPages`, `queryAll`, `readMany` and description-cache implementations through a test subclass of `MdbaseCollectionClient`. Only query evaluation is overridden; description responses enter through the transport so repeated backend calls exercise SDK caching.
- Real SDK record sessions/watch on `createRecordTestAuthority` (as the demo uses).
- Synthetic query evaluator, revision-bearing document-batch transport and binary-file pages; JSON encode/decode models response delivery. Defaults advertise metadata queries and document batches; `PERF_AUTHORITY_FEATURES=0` exercises the unextended legacy authority. The evaluator supports generated `file.path in [...]` filters, literal `record["field"]` named selections and `file.path`/`file.mtime`. Unsupported future expressions/cursor shapes throw rather than produce optimistic results.
- Real search, completion, comment placement/threading and component server rendering; explicit proxy computations for chapter embed resolution and 100-record stats. Round 2 uses the workspace's shared path index in the embed proxy, and adds a cached-placement measurement.
- A compiler stub measures message sizes/`structuredClone`, without Typst, CSL downloads, fonts, WASM, preview rendering or exports.

## Metrics and limits

- `homeListMs`: manuscript metadata query completes (UI can list titles); NOT a Home DOM/paint measurement. Home's three background backend calls start together, as in the component. `homeBackgroundMs` awaits index and source count. Word counts/visible-row body traversal excluded.
- `readyMs`: real workspace snapshot enters `ready`, with the main SDK session open. Editor mounting/first paint excluded.
- `previewInitializedMs`: timestamp when the compiler stub receives `init`; excludes compilation, renderer readiness and paint. The normal fixture waits for Home background discovery first; Round 2 then redundantly enumerated in the workspace, whereas Round 3 reuses that cache. An additional same-size fixture puts 300 annotations on one source and makes only annotation-identity pages 6x slower; `slowAnnotationPreviewMs` and `slowAnnotationIndexMs` show whether that optional scan gates initialization. `annotations300Ms` measures first source grouping/body fetch/parse at ordinary base latency, and `annotations300Transfers` counts only that read.
- `sourcesUsableMs`: library available plus first full-library search; `sourcesFirstSearchMs` is its synchronous cost. SSR panel cost is reported separately, not added to startup.
- `commentsUsableMs`: snapshot contains the relevant comments (Round 2: all 3,000; Round 3: the main record's 300). `commentTransfers` includes metadata and selected bodies; display-only bodies use typed 500-path queries rather than revision-bearing batches; `annotationIdentityTransfers` isolates the 30,000 identity rows; CPU placement/reply stress still uses all 3,000 synthetic comments. `annotationIndexMs`: metadata-only identity discovery completes. `annotationsUsableMs`: the first source's six highlights are ready; `sourceAnnotationsMs` measures that source expansion after metadata discovery. Round 1 could only supply those six after all 30,000 bodies loaded. Panel DOM insertion/paint excluded; annotation parsing IS included.
- `externalRefreshMs`: a known, unopened note watch event through a published collection update. Round 2 uses its actual two-second debounce and coarse refresh; Round 3 uses a 50 ms debounce and one no-body path query. Record metadata is unchanged; only the body changes. `newSourceMs`/`newSourceTransfers` stop when the new library entry becomes visible, so the before transfer count is a **lower bound**: other reconciliation jobs were still running. `sourceWorkerMessages` measures after deltas. `returnHomeMs`/transfers repeat Home's three metadata calls; `navigationTransfers` adds initial Home, workspace and return Home. Excludes visible-row word-count bodies and actual navigation/paint. `noteWorkerMessages` isolates worker traffic for the unrelated note.
- Transfer counts are **responses**, not HTTP requests; `records` includes binary descriptors and duplicate records across queries. `jsonBytes` is uncompressed UTF-8 logical response payload, not encrypted/compressed wire bytes. `bodyBytes` counts requested Markdown bodies. SDK/OAuth/encryption/server evaluation/network bandwidth are excluded. Constructor watch startup is uncounted. `readyTransfers` can include responses from background work already started at `ready` (microtask ordering in the zero-latency control).
- Computation measurements are Node/V8 proxies for browser main-thread work. Seven samples normally, three for heavier operations, one per run for the ~10-second bare-link stress case. SSR is initial server rendering, **not** React update cost, layout, focus, or paint.
- Bare-name comment stress replaces full-path document links with their basename. This exercises the real supported resolver fallback, not an artificially quadratic mock. Chapter proxy reproduces the two resolution calls per embed (Round 1 allocated a Set per embed; Round 2 reuses the generation index), but does not include Markdown parsing, record opens or React rendering. One-off index build cost is measured separately.
- Baselines are observations, not timing assertions. Run on the same machine without concurrent builds for comparisons; raw results retain variance. Current readiness/content assertions fail rather than produce a false successful baseline. This fixture is not a protocol conformance test, a real Connect authority benchmark, or a browser acceptance test.

The beta.117 → beta.123 migration benchmark and checks are recorded in
[docs/sdk-beta123-migration.md](../../../../docs/sdk-beta123-migration.md).
Subsequent migration evidence is recorded in the corresponding PR.

Result JSONs are generated evidence, not source files. The default output is `out/perf/large-collection.json`; parent folders are created automatically. `out/` is gitignored. Historical Round 1–4 result JSONs were removed in Round 5; their key numbers remain below and in `docs/perf-review.md`. Keep future captures in `out/perf/`, not this directory.

The scripts/config are outside `src` and normal test discovery. `generator.ts` is shared with the DEV-only large browser demo, but is not in the production import graph. Initial Home remains cold and collection-wide; only subsequent views reuse its discovery.

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

Start the normal development server, then visit `http://127.0.0.1:5320/?demo=large&manuscript=manuscripts/main.md`. This mode shares `generator.ts` with the Node benchmark; it adds 100 labelled headings, 300 highlights on one source and one 149-reply thread. It uses real ConnectBackend, SDK sessions, compiler and renderer with synthetic 20 ms transport pages. It is DEV-only, even for a production demo build.

```sh
PROFILE_NAME=after PROFILE_OUTPUT=out/perf/browser-after.json pnpm -C apps/writer exec node scripts/perf/browser-profile.mjs
pnpm -C apps/writer test:browser
```

`BASE`, `CHROME`, `PROFILE_NAME`, `PROFILE_OUTPUT` are configurable. The script captures editor/preview visible geometry at animation frames, CDP main-isolate JS heap, >50 ms main-thread long tasks during two ~10 s typing phases, source paging (historically Show all), 300-highlight expansion, citation/embed completion, page errors and `out/large-{sources,comments}-{before,after}.png`. One run is observational, not a statistical timing assertion; heap excludes workers/WASM and is not GC-controlled, and visible canvas is not pixel verification. The default JSON output is `out/perf/browser-profile.json`. Historical before was captured before Round 4 UI changes; after uses a corrected reply counter. Interpretation and deferred work are in `docs/perf-review.md`.
