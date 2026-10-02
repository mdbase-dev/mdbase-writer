# Writer SDK beta.123 migration

## Scope and implementation

Work was confined to `~/worktrees/consumers/mdbase-writer-sdk-beta123`, branch
`sdk/beta123`. No canonical checkout changes, push, PR, deployment, or live-collection
mutations. All four direct `@mdbase-dev/*` dependencies are pinned exactly to
`0.1.0-beta.123`; the lockfile also resolves Connect protocol to that version.
The release-age exceptions now name only beta.123. Node v22.22.0, pnpm 11.15.1.
Disk check: 178 GiB available before installation, 177 GiB after testing.

### Workarounds replaced

| Before | After / reason |
|---|---|
| `selectedBodies` built CEL strings and looped over 500-path batches, draining query pages itself. | `readMany` owns escaped exact-path queries, paging and bounded batch admission. Writer retains per-type grouping, persisted frontmatter, selected-only bodies and a 500-path batch size. |
| `drainChanges` manually sliced changed paths and built another CEL query. | One `readMany` call per coalesced changed-path set; the SDK admits up to four independent 500-path batches. Writer retains its 50 ms debounce, generation fence, store publication and follow-up queue. |
| Path-query failure stopped a serial loop before publication. | Outer failures **and successful outcomes containing batch errors** fail the Writer operation. No failed batch is interpreted as missing/deleted; all affected paths remain retryable, and partial selected bodies are not cached. |
| Writer cached a `describe()` promise indefinitely, evicted it itself, and recreated its store on reload. | SDK success cache, coalescing, failure eviction, 60-second TTL and event invalidation. The remaining method only derives Writer's `CollectionSchema`; replacing bindings preserves classified metadata/body caches on a TTL reload. Explicit reconciliation calls `describe({fresh:true})`. |
| Regex over event IDs, raw payload path parsing, and configured schema-folder/path lists inferred schema changes. | Switch on typed event kinds/fields. Schema/config/contract/view, unknown/malformed, gap/reset, and pathless file removals reconcile; record/file paths refresh incrementally. `reset_required` status handling remains. Ordinary and large demos also consume typed record fields. |

`apps/writer/src/backend/bodies.ts` keeps lazy hydration, cache fencing and domain
parsing; there was no separate CEL builder there to delete. `collection.ts` keeps
contract bindings, metadata classification, scoped comment/reply membership and
annotation grouping. Its schema can be updated without replacing the store.

**Deliberately retained:** Writer's source-scoped `PathIndex`/link resolver rejects
ambiguous basenames. `linksTo`/authority `asFile()` has different, collection-wide
selection semantics, and the installed JS producer does not implement CEL
`asFile()`. The unchanged `query-capabilities.test.ts` passes these probes, including
Writer rejecting `duplicate.md` while the native resolver picks a candidate.
Authoritative `read()` remains for revisions/conditional writes and exact editing;
current `readMany` query rows do not carry authoritative revisions.

### Files and review budget

- Dependencies: `apps/writer/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`.
- Backend and fixtures: `apps/writer/src/backend/{connect.ts,collection.ts,connect.test.ts,demo.ts,large-demo.ts}`.
- Benchmark: `apps/writer/scripts/perf/{large-collection.bench.ts,README.md}`.
- Browser tooling: `apps/writer/scripts/{browser-test.mjs,browser-reliability-test.mjs}`.
- Documentation: `docs/{development.md,sdk-beta123-migration.md}`.

Excluding the perf README and this report, the three implementation commits change
12 files: **228 lines added, 113 deleted** (`git diff origin/main --numstat`).
Backend runtime/demo code accounts for **70 added / 45 deleted**; Connect backend
alone is **49 / 40**. Regression tests are **101 / 24**, benchmark fixture **14 / 5**,
dependency/lock/policy updates **37 / 37**, browser scripts and development guide
**6 / 2**. This is not a net-line-reduction claim: typed reset/file handling and
explicit batch-failure checks add safety, and synthetic descriptions now go through
the real SDK cache rather than bypassing it. No production cache/resolver/scheduler
layer or public API was added.

Implementation commits:

- `146a744` — exact dependency pins and lock/policy update.
- `3964f43` — SDK batching, typed events, derived bindings, demo/perf fixtures and regressions.
- `f3a5483` — configurable browser base URL and isolated-port instructions.

## Verification

- `pnpm install --frozen-lockfile`: passed after final changes.
- `pnpm check`: both package typechecks passed; core **9 files / 65 tests**,
  Writer **29 files / 152 tests**, all passed. Manifest/script tests **7 passed,
  2 skipped, 0 failed**. Existing skips are sibling-checkout comparisons with
  Reader's resource pack and the published comment pack; those paths are absent
  beside this worktree.
- `pnpm -C apps/writer exec tsc -p scripts/perf/tsconfig.json`: passed.
- `pnpm -C apps/writer manifest:validate`: passed.
- Default large-collection benchmark command: **1 test passed** before and after,
  each comprising three independently seeded runs at 20 ms synthetic latency.
- `pnpm dev --port 5321` in an owned background process group, then
  `BASE=http://127.0.0.1:5321/ CHROME=/home/calluma/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell pnpm --filter @mdbase-writer/app test:browser`:
  **32 baseline steps + 20 reliability scenarios passed**, exit 0. Includes large
  demo, autosave/conflicts/recovery, metadata fault injection, PDF/Word/bundle
  exports, cancellation and preview selection. Port 5320 was already occupied;
  it and its server were left untouched. The owned port-5321 dev process group
  was terminated, and the port is no longer listening.
- First browser attempt was interrupted at the 300-second command budget after
  Vite's initial compiler/Pandoc dependency optimization triggered reloads and
  disrupted the demo adoption step, causing cascading failures. With optimization
  settled, the complete retry passed without changing application logic.
- `git diff --check`: passed. No unnecessary build was performed.

Additional regressions cover SDK description coalescing and expiry without store
loss, typed schema/config/contract/view changes, unknown/gap reconciliation,
multi-batch failures without false deletion/partial body caching, retries,
quoted filenames, ordered found/missing entries, and existing scoped hydration.
These are synthetic/installed-JS-authority and demo tests, **not** connected LAB
or production acceptance.

## Large-collection benchmark

Same machine (AMD Ryzen 9 7940HS, Linux, Node v22.22.0), three runs each, 20 ms
per response, 500 binary descriptors per page. 58,100 Markdown records: 5,000
sources, 30,000 annotations, 3,000 comments, 20,000 notes, 100 manuscripts; plus
5,000 binary files. Values below are run medians in milliseconds. This is a Node
backend/workspace proxy, not browser paint or a real authority/network benchmark.

| Metric | beta.117 before | beta.123 after |
|---|---:|---:|
| Home manuscript list | 52.43 | 51.33 |
| Home background discovery | 1,602.62 | 1,607.65 |
| Editing ready (warm discovery) | 44.81 | 44.04 |
| Preview worker initialization (warm discovery) | 57.44 | 53.60 |
| Scoped comments usable | 193.73 | 211.07 |
| Annotation identity discovery | 794.84 | 816.76 |
| First source's six annotations | 64.23 | 72.84 |
| Selected 300 annotations | 66.27 | 67.91 |
| Unrelated-note external refresh | 73.68 | 73.93 |
| New source visible | 117.98 | 122.80 |
| Return Home cached calls | 0.01 | 0.01 |
| Slow-annotation fixture preview initialization | 1,591.21 | 1,589.66 |
| Slow-annotation fixture identity discovery | 3,980.07 | 3,974.23 |

Traffic totals are unchanged across all runs before/after:

- Home → workspace → Home: **113 responses / 36,006,846 logical JSON bytes**.
- Unrelated note: **1 response / 357 JSON bytes / 0 body bytes**.
- Scoped comments: **4 responses / 3,300 rows including metadata / 163,200 body bytes**.
- Selected 300 annotations: **1 response / 300 records / 315,900 body bytes**.
- Cold Home: **76 responses / 26,587,086 JSON bytes**, including one description.

No speedup claim: timings show small regressions as well as improvements, and
there is no controlled statistical significance claim. The migration preserves
selected-body and incremental traffic, preview independence and cached navigation.
The standard fixture's selected body reads fit in one batch; unit regressions
exercise larger concurrent batches. SDK description-cache overhead is included.

Generated evidence (gitignored):

- `apps/writer/out/perf/beta117-before.json`
- `apps/writer/out/perf/beta123-after.json`
- `apps/writer/out/sdk-beta123/` — installation/check/manifest/perf/browser logs,
  including the failed first browser attempt and successful retry.

## Behaviour changes, risks and wave B

- `readMany` returns requested-path order, not authority row order. After an
  annotation update/move/rename, highlight order follows Writer's current scoped
  metadata-map order; updated entries may move to the end. Content/membership and
  ambiguity rejection are unchanged; ordering assertions now cover that contract.
- Large bursts can overlap up to four SDK batches. They are bounded but are not
  one atomic collection snapshot. Writer's generation checks/coalesced follow-up
  remain; a batch failure conservatively retries the entire changed set.
- Unknown/malformed events, view changes, gaps and pathless file removals now
  force authoritative reconciliation instead of being ignored/guessed. Producers
  must publish the supported schema-change events; record-path schema inference
  is deliberately removed. Explicit reconciliation bypasses settled description
  cache, including manual/watch-status reset boundaries.
- Cached descriptions are metadata, never authorization evidence. TTL updates
  refresh bindings without dropping existing discovery data; schema events still
  clear/reload classified metadata and lazy bodies.
- Wave B **authority feature discovery** could replace producer capability probes,
  but does not make authority links equivalent to Writer's resolver.
- **Revisioned batches** could help future editing hydration, but revision-bearing
  reads must remain until negotiated authority support exists.
- **Metadata queries** could reduce cold discovery/frontmatter/CSL transfer; current
  projections are additive, so the installed producer cannot deliver that saving.
- **files.stat** could replace folder enumeration in `changedFiles` and stale
  descriptor refresh in `readFile`; initial collection file discovery remains.
