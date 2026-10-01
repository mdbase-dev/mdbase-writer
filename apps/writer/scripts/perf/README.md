# Large collection benchmark (opt-in, local only)

From the repository root:

```sh
pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
pnpm -C apps/writer exec tsc -p scripts/perf/tsconfig.json
pnpm -C apps/writer typecheck
```

Capture JSON (output path is relative to `apps/writer`):

```sh
PERF_OUTPUT=scripts/perf/result.json pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
PERF_RUNS=1 PERF_LATENCY_MS=0 PERF_OUTPUT=scripts/perf/control.json pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
```

Defaults: three independently seeded runs, 20 ms per query/describe/open/people/file-page response, 500 binary descriptors per file page. Override `PERF_RUNS`, `PERF_LATENCY_MS`, `PERF_FILE_PAGE_SIZE`. `PERF_STRICT_CONTRACTS=0` allows body-bearing contract queries for comparison with a permissive authority; default enforces the installed SDK's documented contract-query restrictions. Round 1's rejected cursor capability probe was retried by real SDK pagination before the type fallback. Round 2 no longer issues body-bearing contract queries.

The deterministic collection has 5,000 sources, 30,000 annotations, 3,000 comments, 20,000 notes, 100 manuscripts (58,100 Markdown records), and 5,000 binary files. Source CSL includes a ~680-character abstract, annotation bodies ~1 KiB, comment bodies ~0.5 KiB. Notes/source bodies are seeded but not bulk transferred. 300 comments belong to the main record; the remainder belong to other notes.

## What runs

- Real `ConnectBackend`, real `ManuscriptWorkspace` startup and watch-triggered refresh.
- Real SDK `queryPages` implementation through a test subclass of `MdbaseCollectionClient`.
- Real SDK record sessions/watch on `createRecordTestAuthority` (as the demo uses).
- Synthetic query evaluator and binary-file pages; JSON encode/decode models response delivery. Unsupported future query features throw rather than silently return incorrect results. The evaluator supports exactly the generated `file.path in [...]` filters; extend it before benchmarking other `where`/`select`/cursor shapes.
- Real search, completion, comment placement/threading and component server rendering; explicit proxy computations for chapter embed resolution and 100-record stats. Round 2 uses the workspace's shared path index in the embed proxy, and adds a cached-placement measurement.
- A compiler stub measures message sizes/`structuredClone`, without Typst, CSL downloads, fonts, WASM, preview rendering or exports.

## Metrics and limits

- `homeListMs`: manuscript metadata query completes (UI can list titles); NOT a Home DOM/paint measurement. Home's three background backend calls start together, as in the component. `homeBackgroundMs` awaits index and source count. Word counts/visible-row body traversal excluded.
- `readyMs`: real workspace snapshot enters `ready`, with the main SDK session open. Editor mounting/first paint excluded.
- `previewInitializedMs`: timestamp when the compiler stub receives `init`; excludes compilation, renderer readiness and paint. The normal fixture waits for Home background discovery first; Round 2 then redundantly enumerated in the workspace, whereas Round 3 reuses that cache. An additional same-size fixture puts 300 annotations on one source and makes only annotation-identity pages 6x slower; `slowAnnotationPreviewMs` and `slowAnnotationIndexMs` show whether that optional scan gates initialization. `annotations300Ms` measures first source grouping/body fetch/parse at ordinary base latency, and `annotations300Transfers` counts only that read.
- `sourcesUsableMs`: library available plus first full-library search; `sourcesFirstSearchMs` is its synchronous cost. SSR panel cost is reported separately, not added to startup.
- `commentsUsableMs`: snapshot contains the relevant comments (Round 2: all 3,000; Round 3: the main record's 300). `commentTransfers` includes metadata and selected bodies; CPU placement/reply stress still uses all 3,000 synthetic comments. `annotationIndexMs`: metadata-only identity discovery completes. `annotationsUsableMs`: the first source's six highlights are ready; `sourceAnnotationsMs` measures that source expansion after metadata discovery. Round 1 could only supply those six after all 30,000 bodies loaded. Panel DOM insertion/paint excluded; annotation parsing IS included.
- `externalRefreshMs`: a known, unopened note watch event through a published collection update. Round 2 uses its actual two-second debounce and coarse refresh; Round 3 uses a 50 ms debounce and one no-body path query. Record metadata is unchanged; only the body changes. `newSourceMs`/`newSourceTransfers` stop when the new library entry becomes visible, so the before transfer count is a **lower bound**: other reconciliation jobs were still running. `sourceWorkerMessages` measures after deltas. `returnHomeMs`/transfers repeat Home's three metadata calls; `navigationTransfers` adds initial Home, workspace and return Home. Excludes visible-row word-count bodies and actual navigation/paint. `noteWorkerMessages` isolates worker traffic for the unrelated note.
- Transfer counts are **responses**, not HTTP requests; `records` includes binary descriptors and duplicate records across queries. `jsonBytes` is uncompressed UTF-8 logical response payload, not encrypted/compressed wire bytes. `bodyBytes` counts requested Markdown bodies. SDK/OAuth/encryption/server evaluation/network bandwidth are excluded. Constructor watch startup is uncounted. `readyTransfers` can include responses from background work already started at `ready` (microtask ordering in the zero-latency control).
- Computation measurements are Node/V8 proxies for browser main-thread work. Seven samples normally, three for heavier operations, one per run for the ~10-second bare-link stress case. SSR is initial server rendering, **not** React update cost, layout, focus, or paint.
- Bare-name comment stress replaces full-path document links with their basename. This exercises the real supported resolver fallback, not an artificially quadratic mock. Chapter proxy reproduces the two resolution calls per embed (Round 1 allocated a Set per embed; Round 2 reuses the generation index), but does not include Markdown parsing, record opens or React rendering. One-off index build cost is measured separately.
- Baselines are observations, not timing assertions. Run on the same machine without concurrent builds for comparisons; raw results retain variance. Current readiness/content assertions fail rather than produce a false successful baseline. This fixture is not a protocol conformance test, a real Connect authority benchmark, or a browser acceptance test.

`baseline-20ms.json` contains the three-run Round 1 baseline; `baseline-0ms.json` contains its one-run latency-free control. `round2-20ms.json` and `round2-0ms.json` retain the initial P0 delivery. `round2-review-before-20ms.json` measures that implementation with new preview/300-highlight milestones; `round2-review-after-20ms.json` and `round2-review-after-0ms.json` are the final reviewed implementation. Dataset/payload assumptions are unchanged; the script was adapted to the new backend API and now awaits all metadata domains before taking complete-workspace/refresh transfer totals. `round3-before-20ms.json` captures the committed Round 2 implementation before Round 3 changes; `round3-after-20ms.json` and `round3-after-0ms.json` capture shared-cache/incremental/scoped-comment behaviour. Initial Home remains cold and collection-wide; only subsequent views reuse its discovery. See `docs/perf-review.md` for interpretation. The harness/config/results are outside `src` and normal test discovery. `generator.ts` is shared with the DEV-only large browser demo, but is not in the production import graph.

## Chromium responsiveness profile (Round 4)

Start the normal development server, then visit `http://127.0.0.1:5320/?demo=large&manuscript=manuscripts/main.md`. This mode shares `generator.ts` with the Node benchmark; it adds 100 labelled headings, 300 highlights on one source and one 149-reply thread. It uses real ConnectBackend, SDK sessions, compiler and renderer with synthetic 20 ms transport pages. It is DEV-only, even for a production demo build.

```sh
PROFILE_NAME=after PROFILE_OUTPUT=scripts/perf/round4-browser-after.json pnpm -C apps/writer exec node scripts/perf/browser-profile.mjs
pnpm -C apps/writer test:browser
```

`BASE`, `CHROME`, `PROFILE_NAME`, `PROFILE_OUTPUT` are configurable. The script captures editor/preview visible geometry at animation frames, CDP main-isolate JS heap, >50 ms main-thread long tasks during two ~10 s typing phases, source paging (historically Show all), 300-highlight expansion, citation/embed completion, page errors and `out/large-{sources,comments}-{before,after}.png`. One run is observational, not a statistical timing assertion; heap excludes workers/WASM and is not GC-controlled, and visible canvas is not pixel verification. Before was captured before Round 4 UI changes; final after uses a corrected reply counter. `round4-20ms.json` retains the three-run Node benchmark; `round4-0ms.json` is its zero-latency control. Interpretation and deferred work are in `docs/perf-review.md`.
