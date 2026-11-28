# Large collection benchmarks (opt-in)

From the repository root:

```sh
pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
rpnpm --filter @mdbase-writer/app typecheck:perf
pnpm -C apps/writer typecheck
```

Run all Vitest benchmarks with `rpnpm --filter @mdbase-writer/app test:perf-fixture`. This uses one zero-latency run of the collection fixture.

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

## Paired interactive Chromium profile

Start a DEV server for each revision on a separate port. Copy the benchmark's
`interactive-profile.mjs`, `outline.bench.tsx`, `large-demo.ts` and `DemoRoot.tsx`
to the same locations in the baseline checkout. The last two files enable
the same fixture sizes on both revisions.

```sh
# In separate shells, from each checkout
pnpm -C apps/writer dev --port 5437  # baseline
pnpm -C apps/writer dev --port 5438  # candidate

BASELINE=http://127.0.0.1:5437 BASE=http://127.0.0.1:5438 PROFILE_CHAPTERS=120 \
  pnpm -C apps/writer exec node scripts/perf/interactive-profile.mjs > paired.jsonl
```

Each of seven rounds runs the two-chapter worked example and a large manuscript
on both revisions. Revision order reverses each round. Each sample opens a fresh
browser context, waits for the chapter count and bibliography revision, then
uses the visible Sources panel, outline search, editor and citation completion.
Typing must synchronously checkpoint the exact edit in local storage, and normal
SDK autosave must confirm the same body. Startup timings include navigation,
demo seeding and development module loading. The bibliography timing includes
full preview rendering. Action timings include Playwright input and waiting for
the result. Renderer CPU uses CDP thread ticks.

The 120-chapter demo explicitly checks the pinned SDK's session limit. The
workspace must discover all 120 chapters and report 57 failed opens alongside
the main record and 63 loaded chapters. Search and editing use loaded chapters.
Omit `PROFILE_CHAPTERS` for the fully loaded 60-chapter comparison. The mounted
outline benchmark above measures all 120 chapter bodies and all 120 rows with
real React components and manuscript statistics in jsdom.

## Recorded outcomes

### Source lookup, long-chapter typing and Word export

The baseline is `d10c4ef` (#246). Copy `citations.bench.ts`, `citation-typing-profile.mjs`, `docx-profile.mjs` and `generator.ts` from this revision into the matching `apps/writer/scripts/perf` directory of a baseline checkout. Also copy `apps/writer/src/backend/large-demo.ts` and `apps/writer/src/ui/DemoRoot.tsx` to enable the long chapter in the baseline demo.

```sh
rpnpm --filter @mdbase-writer/app test:perf-fixture scripts/perf/citations.bench.ts
pnpm dev
```

Run the Chromium profiles in a separate shell. Set `BASE` if the development server uses a different port. Use separate output directories on each revision and point the second DOCX run at the first revision's `run-1.docx`.

```sh
pnpm -C apps/writer exec node scripts/perf/citation-typing-profile.mjs
PROFILE_OUTPUT=/tmp/writer-docx-before pnpm -C apps/writer exec node scripts/perf/docx-profile.mjs
PROFILE_OUTPUT=/tmp/writer-docx-after PROFILE_REFERENCE=/tmp/writer-docx-before/run-1.docx \
  pnpm -C apps/writer exec node scripts/perf/docx-profile.mjs
```

Vitest used Node 22.22.0 on the remote builder (AMD EPYC 9B14) and took seven measurements after two warmups. It loads 5,000 sources and builds the real APA preview bibliography for 100 cited entries. Warm lookup timings average 100 calls per sample.

| Vitest median | Before | After |
|---|---:|---:|
| Cold source index and broad lookup | 8.82 ms | 6.74 ms |
| Warm broad source lookup | 0.399 ms | 0.114 ms |
| Warm precise citekey lookup | 0.508 ms | 0.521 ms |
| Cold APA bibliography | 390.0 ms | 413.4 ms |
| Cached APA bibliography | 0.066 ms | 0.066 ms |

Chromium 149.0.7827.55 ran on an AMD Ryzen 9 7940HS with Node 22.22.0. Each sample uses a fresh context and waits for the collection and preview assembly. The typing run clears source search, opens the Outline and inserts 22 characters into a 78,762-byte chapter. Picker timing includes Playwright round trips and React rendering. Typing timing measures from `beforeinput` to the next animation-frame callback. CDP reports renderer main-thread CPU time for the typing phase. `PROFILE_CPU` can capture a DevTools profile for each run.

| Chromium median | Before | After |
|---|---:|---:|
| Sources query to matching row, 5 contexts | 29.6 ms | 26.3 ms |
| Typing input to animation frame, 5 contexts | 23.2 ms | 14.5 ms |
| Typing p90 input to animation frame, 5 contexts | 37.0 ms | 24.4 ms |
| Renderer main-thread CPU for 22 inputs, 5 contexts | 1,139 ms | 516 ms |
| Word export preflight, 3 contexts | 371 ms | 81 ms |
| Inside Word export handler, 3 contexts | 2,008 ms | 1,789 ms |
| Chapter save to Word download, 3 contexts | 3,518 ms | 3,236 ms |

The Word run uses 60 chapters, 480 chapter passages, 100 cited sources and 5,000 available sources. All three DOCX files match the baseline package parts after timestamp normalization. Warm broad lookup benefits from stopping after the top metadata matches are known. Word preflight now reuses dependency and diagnostic analysis while Pandoc formats the citations and bibliography. Fetching and converting with Pandoc accounts for 1.67 seconds of the after median. These are development fixture timings using the SDK's in-memory replica on a shared host.

### Earlier collection and outline measurements

Outline comparison on the remote builder (AMD EPYC 9B14, Node 22.22.0). The two revisions ran the same outline benchmark three times each, with Writer at `ba47bda` for the control. The p50 columns are medians of the three runs. The p95 columns show the spread across runs.

| Operation | Before p50 | After p50 | Before p95 range | After p95 range |
|---|---:|---:|---:|---:|
| Typing in one chapter | 19.97 ms | 16.76 ms | 21.66–49.75 ms | 19.00–47.49 ms |
| Switching chapters | 21.98 ms | 18.57 ms | 20.45–60.42 ms | 18.89–19.30 ms |
| Sparse manuscript search (1 hit) | 1.31 ms | 1.31 ms | 1.32–1.40 ms | 1.32–1.33 ms |
| Broad manuscript search (34,560 hits) | 2.46 ms | 2.38 ms | 2.87–4.62 ms | 2.68–2.77 ms |

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

`BASE`, `CHROME`, `PROFILE_NAME`, and `PROFILE_OUTPUT` are configurable. Set `PROFILE_EDITOR_ONLY=1` to measure editing with the preview pane hidden.
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

### 60-chapter Chromium comparison

Both runs used `PROFILE_EDITOR_ONLY=1` on an AMD Ryzen 9 7940HS with Node 22.22.0 and Playwright's Chromium. The split-view attempts timed out while returning to the main record. The editor-only pair edited a chapter and used the export controls for the full workspace. Each run loaded 60 chapters, 300 comment records, and 5,000 sources. Comments showed 50 threads and 50 replies in both runs.

| Action | Before | After |
|---|---:|---:|
| Switch through four chapters | 4.17 s | 2.46 s |
| Type with Outline open | 1.81 s | 1.19 s |
| Type with Comments open | 2.41 s | 1.68 s |
| Type with Sources open | 1.01 s | 1.22 s |
| Filter sources | 288 ms | 98 ms |
| Sparse outline search (1 result) | 272 ms | 730 ms |
| Broad outline search (480 results) | 761 ms | 461 ms |
| Download Word document | 43.15 s | 44.39 s |

Both exports produced a 27,086-byte DOCX containing the Word document part. The two browser runs had long tasks above 20 seconds around export and source interactions. The browser measurements are single observations. The repeated Vitest runs establish the outline comparison.

### Word export during a chapter save

With `pnpm dev` running, use the dedicated Chromium benchmark to time a chapter
save overlapping a Word download. Each run opens a fresh browser context, edits
the first chapter with Outline and Comments open, starts a save, and uses the
Word export menu. The browser fixture has 60 chapters, 300 manuscript comment
records, and 5,000 sources.

```sh
PROFILE_OUTPUT=/tmp/writer-docx-before pnpm -C apps/writer exec node scripts/perf/docx-profile.mjs
PROFILE_OUTPUT=/tmp/writer-docx-after PROFILE_REFERENCE=/tmp/writer-docx-before/run-1.docx \
  pnpm -C apps/writer exec node scripts/perf/docx-profile.mjs
```

Run the first command with the benchmark and fixture on the baseline revision.
The script takes three samples by default. It reports save-to-download time,
time before the export handler starts, time inside the handler, and main-thread
long-task time. Python checks the ZIP, all 480 chapter passages, the edit, the
bibliography and the cited footnote. Every uncompressed package part is
compared, with creation and modification timestamps normalized. Writer review
threads stay in the collection.

### Earlier browser measurements

On the fixture-corrected product comparison, cold preview went from 3,426 to
2,134 ms and the GC-controlled main heap from 60.91 to 58.28 MiB.
Uncollected heap is still recorded for historical comparisons, not treated as a
retention measurement.

The script captures editor and preview geometry at animation frames, CDP main-isolate JS heap, and main-thread tasks over 50 ms. It measures chapter switching, typing the same text with Outline, Sources and Comments open, sparse and broad outline search, source filtering and paging, highlight expansion, citation and embed completion, and Word export. It checks the finished edits, search result counts, and the presence of a Word document part in the downloaded DOCX. Browser action timings include Playwright round trips. Each typing phase uses 12 text inputs with no added delay. One Chromium run per revision is observational. The main heap excludes workers and native backing storage. The default JSON output is `out/perf/browser-profile.json`. The original Round 4 heap field was not GC-controlled. Interpretation of the earlier runs is in `docs/perf-review.md`.
