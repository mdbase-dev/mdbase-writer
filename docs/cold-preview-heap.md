# Cold preview and retained heap

Profiled `perf/cold-preview-heap` against `b97237695c2b5203731a43ec9bddf30dd6feaf98`.
DEV `?demo=large&manuscript=manuscripts/main.md`: the same 58,100 Markdown records,
5,000 sources, 30,000 annotation identities, 3,000 comment identities, 300 scoped
comment bodies, 5,000 binary descriptors and 100 manuscript citations as earlier rounds.
No framework/dependency added; no Connect daemon or real collection used.

## Method and evidence

Fresh Playwright Chromium processes (headless shell 1228), 1500×950, HTTP cache
explicitly disabled and service workers bypassed. Vite servers were warmed first;
**browser caches were cold**, not the development server's transformation cache.
Alternating three control/final runs, no concurrent checks launched by this agent.
The machine had unrelated builds/tests running (load averages roughly 20–47), so
retain ranges and don't interpret small differences as statistical guarantees.

`apps/writer/scripts/perf/browser-profile.mjs` records first editor/canvas geometry
and the renderer's first drawn-revision marker at animation frames, worker message
sizes/send time, init/result timing, worker resource timings, startup/interaction
long tasks, main heap before/after forced GC, and worker GC-controlled heap usage.
Logical message-size serialization adds opt-in harness overhead to both sides.
Heap is measured **after all four discovery domains are ready**, even when preview
arrives earlier. This is not pixel verification, input-event latency or process RSS.
Main heap excludes workers/native backing storage; worker JS/native counters are
reported separately. Optional CPU and main/worker heap snapshots are supported.

Generated evidence is ignored under `apps/writer/out/perf/`:

- `baseline-{1,2,3}.json`: untouched HEAD, including the original fixture.
- `control-final-{1,2,3}.json`: HEAD with **only** fixture text sharing and stale
  demo-effect avoidance applied. This isolates the product changes.
- `after-final-{1,2,3}.json`: final product and fixture, same profiler.
- `before.{cpuprofile,heapsnapshot}`, `before-heap-summary.json`: initial investigation
  (system Chrome, not the timing comparison's headless shell).
- `main-final.{cpuprofile,heapsnapshot}`, `main-final-summary.json`,
  `worker-final-*.heapsnapshot`, `worker-final-summary.json`: main/worker retention
  investigation. The snapshots precede the self-contained-preview gate change;
  shared-index and fixture memory changes are already present.
- `node-final.json`: one ordinary 20 ms Node benchmark run; dedicated benchmark
  typecheck also passed. Raw historical Round 1–5 captures are not restored.

The control was made from a `git archive` of HEAD in `/tmp/writer-perf-baseline`,
not by resetting the feature worktree. Scripts and controls remain reproducible
from the referenced commit and this branch's fixture/App changes.

## Results

Medians; MiB means bytes / 1,048,576. **Control → final** is the product comparison:

| Metric | Original HEAD | Fixture-corrected control | Final |
| --- | ---: | ---: | ---: |
| First preview canvas/drawn marker | 5,380 ms | **3,426 ms** | **2,134 ms** |
| Preview range | 4,950–15,325 ms | 3,350–4,382 ms | 1,999–2,215 ms |
| Editor geometry | 2,699 ms | 1,104 ms | 1,034 ms |
| Main heap, no forced GC | 192.83 MiB | 76.59 MiB | 88.20 MiB |
| Main heap, after GC/full discovery | 146.84 MiB | **60.91 MiB** | **58.28 MiB** |

Product changes reduce the controlled first-preview median by **38% / 1.29 s**
and retained main heap by **2.63 MiB**. The much larger original→final heap change
is overwhelmingly a **demo fixture correction**, not a claim of saving 89 MiB in
a real user's library. Uncollected heap is noisy and even rises control→final;
this is why the historical ~261 MiB observation is not used as a controlled baseline.
The original timing outlier coincided with heavy system contention.

Startup tasks through full discovery/first preview: median count **6 → 6**,
total **825 → 812 ms**, max **451 → 373 ms**. Early preview does not remove the
full metadata workload. Interaction long-task counts in the three control/final runs:

| Phase | Control counts | Final counts |
| --- | --- | --- |
| Sources, ~10 s typing | 0 / 0 / 16 | 1 / 1 / 0 |
| Show 50 more sources | 0 / 0 / 2 | 0 / 0 / 0 |
| Expand 300-highlight source (50 mounted) | 1 / 1 / 2 | 1 / 1 / 0 |
| Citation completion | 0 / 0 / 0 | 0 / 0 / 0 |
| Embed completion | 0 / 0 / 3 | 0 / 0 / 0 |
| Comments, ~10 s typing | 1 / 0 / 24 | 0 / 0 / 0 |

Final Sources tasks were 60/59 ms; highlight tasks 64/50 ms. The last final run
has zero tasks in all six phases. These are observations under variable contention,
not a guarantee of zero long tasks or a new list-rendering optimisation.

## Where the time and memory went

- **Index gate was the principal avoidable delay.** In the final run, compiler
  ready arrives at 1,318 ms, first result at 2,082 ms, first visible preview at
  2,134 ms; full discovery is observed at 2,739 ms. Control waited until 3,076 ms
  for compiler readiness before its first result. A self-contained document
  doesn't need 58,100 paths to typeset its text and citations.
- **Assets/init:** final compiler preparation takes 123–143 ms in the three
  captures. Fonts finish in roughly 10–25 ms locally; compiler WASM fetch is
  ~109 ms in final run 3. It now starts concurrently with fonts and well before
  collection discovery finishes. CSL style/locale fetching also overlaps discovery.
  These are localhost transfer times, not predictions for a remote cold download.
- **First assembly/compile:** final first assembly 457–491 ms, including citeproc
  processing 135–153 ms; Typst compile/vector/position queries 258–292 ms.
  The assembly remainder includes translation and CSL engine/style construction.
  Later identity/path arrivals use cached citations: assembly ~1–2 ms and
  compile ~13–20 ms. Compiler/renderer/WASM remain substantial unavoidable costs.
- **Messages:** full init is still 5,660,846 logical JSON bytes / 5,000 CSL items;
  sender-side posting is milliseconds, not the dominant cold delay. All CSL fields
  remain available to custom styles and later citations. The early collection
  message is 53 bytes; complete paths arrive in a later delta, not a second init.
  No unsafe CSL field stripping or cited-only library protocol was introduced.
- **Main retention:** snapshot string accounting found ~85.99 MiB of separately
  flattened identical synthetic note, annotation, source, comment and abstract
  strings. Shared fixture constants reduce these categories to a few KiB, without
  changing record contents/counts or logical transfer sizes. Stale StrictMode demo
  effects now stop before seeding a second authority. The authority's stored-record
  map (~6.16 MiB exclusive) and the fixture query-row map (~5.09 MiB) still exist;
  neither is a real connected Writer's server-side dataset.
- **Product metadata:** the store retains classifications, annotation identities,
  scoped comment metadata, library entries and path indexes, not all remote bodies.
  Main store exclusive retention goes ~6.97→5.47 MiB; workspace exclusive retention
  ~1.62→0.19 MiB. Shared strings change dominators, so these figures are **not
  additive**. Duplicated index backing tables/sent Sets were the useful product
  saving; required annotation/comment identities weren't dropped.
- **Editor/translation:** four EditorState objects were present (largest exclusive
  retention ~0.1 MiB), not 58,100 editor states. Main derivations only cover open
  records. Worker assembler overhead beyond its citation-engine map is ~64 KiB
  in this one-record manuscript. Neither was the large cold heap holder.
- **Worker:** after GC, ~67.1 MiB JS heap, separately ~4.55 MiB reported backing
  storage; the snapshot also includes native allocations omitted by those JS
  counters. The CSL engine dominates ~46 MiB, largely its citation/bibliography
  sort token/closure graphs. Full worker library Map ~5.47 MiB. This work does
  **not** claim a worker/WASM memory breakthrough: patching third-party sort-token
  expansion or dropping CSL fields would carry citation correctness risks.

`heap-summary.mjs` reports strong-edge dominators, selected class counts and
synthetic string categories. Snapshot native bytes and JS metrics differ;
shared references/debugger roots prevent treating every reachable byte as exclusive.

## Behaviour and validation

- `prepare` loads compiler assets once; it cannot compile or announce ready before
  `init` supplies library/style snapshots. Failures/timeouts/retry remain bounded.
- Only dependency-free bodies with bundled layouts/styles bypass the index wait.
  Embeds, images, custom `.typ`/`.csl`, and dependencies added during async waits
  still require the **complete** index. No partial-basename lookup is accepted.
  Late index/annotation data refreshes the worker; the preview stays labelled
  provisional until discovery settles. Exports still await complete metadata.
- Immutable-array index sharing uses a WeakMap; mutable Sets retain the old API.
  Replacement generations preserve exact→relative→unique-basename precedence and
  ambiguity rejection (including the existing 7,500 generated resolver comparisons).
- `pnpm check` passed: **66 core + 173 Writer Vitest tests**, Node checks
  **12 passed / 2 skipped**, typechecks. New tests cover prepare/no-early-compile,
  failures, early self-contained preview, full-index dependency gates, async edit
  rechecking, export waiting and immutable generations.
- `COLD_CACHE=1 BASE=http://127.0.0.1:5322/ pnpm -C apps/writer test:browser`
  passed **53 Chromium scenarios**, including a new held-index early-preview/export
  case and existing failure/retry, citation updates, annotation scopes, recovery,
  conflicts, accessible rendering and all export formats. Small-demo first edit
  to drawn preview: 835 ms in the final strict cold-cache run, not a large-demo
  cold-start measurement. `pnpm build` also passed (existing chunk-size warning);
  no large-fixture strings are present in production assets.

Real-daemon/LAB acceptance, broad initial enumeration, cancelable discovery,
cache eviction and CSL engine memory optimisation remain separate follow-ups.
