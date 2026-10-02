# Writer SDK beta.124 migration

## Changes

- Exact beta.124 pins for Connect, UI, Connect Dev and Connect Testing; regenerated lockfile contains only beta.124 mdbase packages. Removed the beta.123 startup-cancellation patch and `patchedDependencies`.
- Annotation/comment discovery uses `supportsAuthorityFeature("query-metadata-v1")` before selecting metadata output. Unsupported authorities retain the original persisted-frontmatter queries. Discovery and advertised-query failures remain visible; neither is a fallback probe.
- Collection index discovery also uses metadata output, selecting the union needed to classify records. Source CSL/title, manuscript title/template/style/mtime and person names remain available. Selection includes the classification-field union across active bindings, with literal escaped field names for custom mappings. A type filter does not exclude other co-typed roles; selecting only the queried binding's fields could erase a different mapped annotation/source/manuscript role. Narrow values are classified as partial metadata, not cast to full query records/documents.
- Comment discovery retains only document/reply identity; target/suggestion/status and body come from selected hydration. `created_at` is selected to preserve the existing usable-comment validation.
- `CollectionBodies` already used `readMany` via `ConnectBackend.selectedBodies`; there were **no revision point reads to delete** in this checkout. The SDK now negotiates revision-bearing document batches automatically. Writer needs no revision cache or new hydration layer. Legacy bodies still use path queries with no point reads, because Writer does not need a revision token for this display path. Conditional comment edits and exact record reads remain point reads.
- Writer's source-scoped `PathIndex` and ambiguity rejection are unchanged. Tests exercise explicit relative links and duplicate bare names on both metadata and legacy paths; no authority `asFile()` predicate is substituted.

## Large-collection measurements

Local Node synthetic transport, 58,100 records / 5,000 files; three runs, 20 ms per response, 500 file descriptors/page. Real backend, workspace, SDK pagination/readMany and record sessions; no real authority query execution, encryption, network bandwidth, Typst or browser paint. JSON bytes are logical uncompressed response bytes, and response counts are not HTTP request counts.

The original beta.123 baseline was captured before edits in `apps/writer/out/perf/beta124-before.json`. The upgraded fixture implements metadata selection/document batches and has two reproducible modes:

```sh
PERF_AUTHORITY_FEATURES=0 PERF_OUTPUT=out/perf/beta124-legacy.json pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
PERF_OUTPUT=out/perf/beta124-after.json pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
```

The final legacy/qualified captures ran serially without overlapping this agent's checks or browser suites. Transfer totals are deterministic; the beta.124 legacy navigation payload differs from beta.123 by only 27 description bytes. Timings vary on this shared machine; these are observations, not speed assertions.

| Logical payload | Legacy before | Qualified after |
| --- | ---: | ---: |
| 30k annotation identities | 8,120,881 B / 30 responses | 5,307,382 B / 30 responses |
| Home discovery | 26,587,113 B / 76 responses | 21,724,359 B / 76 responses |
| Workspace discovery + selected bodies | 9,419,760 B / 37 responses | 6,397,249 B / 43 responses |
| Home → workspace → Home | 36,006,873 B / 113 responses | 28,121,608 B / 119 responses |
| Comment discovery + 300 bodies + preselection | 1,282,591 B / 4 responses | 1,070,206 B / 9 responses |
| First 300 highlights | 401,047 B / 1 response | 567,846 B / 6 responses |

Annotation identity bytes fell **34.6%**; navigation bytes fell **21.9%**. The final selectors include file mtime/classification fields for potentially co-typed roles, not just annotation source/comment links. Comment body bytes are unchanged at 163,200 B, and the 300-highlight body bytes remain 315,900 B: hydration is still selective, not a bulk-body scan. The authority round-2 28.9 MB → 6.2 MB result uses a different, wider real-engine fixture and is not reproduced/claimed by this benchmark.

| Three-run median, ms | Original beta.123 | beta.124 legacy control | beta.124 qualified |
| --- | ---: | ---: | ---: |
| Home background discovery | 1,612 | 1,631 | 1,671 |
| Editing ready | 43 | 41 | 43 |
| Warm preview initialization | 52 | 50 | 55 |
| Comments usable | 212 | 209 | 234 |
| Annotation identities ready | 815 | 847 | 858 |
| First source's six highlights | 66 | 84 | 90 |
| First 300 highlights | 72 | 77 | 197 |
| Unrelated-note publication | 74 | 74 | 72 |
| New source visible | 118 | 125 | 122 |

Qualified batch hydration is slower/larger here: the SDK caps document batches at 100 paths and retains authority-owned type preselection, so 300 highlights need three selection responses plus three document responses rather than one legacy 500-path query. This buys coherent body/revision pairs, not fewer requests relative to Writer's already-batched beta.123 path. No extra per-record revision reads occur. Compiler initialization still does not wait for the deliberately slowed annotation-only scan (qualified medians 1,662 ms initialization vs 4,082 ms annotation completion).

Generated JSON evidence stays under gitignored `apps/writer/out/perf/`, not in source control.

## Verification

Dependency-only commit:
- `pnpm install --frozen-lockfile`: supply-chain policy passed with final beta.124 exclusions.
- `pnpm check`: core 65 tests; Writer 152 Vitest tests; script tests 12 passed / 2 environment-gated skips.
- `pnpm -C apps/writer exec tsc -p scripts/perf/tsconfig.json`: passed.
- Both browser suites: 52 scenarios passed with a warm Vite cache. The first cold run reproduced the pre-existing mid-test Typst dependency reload; the coordinator requested a separate canary-fix commit.

Wave-B commit:
- `pnpm check`: core 65 tests; Writer 161 Vitest tests; script tests 12 passed / 2 environment-gated skips.
- Performance TypeScript check and both three-run benchmark modes: passed.
- Both browser suites: 52 scenarios passed.
- Added narrow/full classification parity, multi-role/co-typed metadata/mtime, literal field escaping, negotiated bodies, mapped comment scope/replies, no-probe fallback/failure, and old/new ambiguity tests.

## Separate consumer-canary environment fix (#562)

Cold Vite logs before the fix showed late optimization of `@myriaddreamin/typst.ts/compiler` and `@myriaddreamin/typst.ts/options.init`, followed by `optimized dependencies changed. reloading`. That reload reset the in-memory demo during manuscript adoption. The same audit passed warm.

`vite.config.ts` now explicitly pre-optimizes the Typst compiler, initialization options and renderer entrypoints, plus the deferred `pandoc-wasm/core` export loader. The WASM implementation packages remain excluded as before. This fixes dependency discovery at startup rather than warming the cache or retrying the adoption test. Both the reliability suite and performance browser profiler now use `process.env.CHROME` or Playwright's package-managed browser, with no machine-specific executable fallback.

Verification, with the development server stopped before deleting caches:

```sh
rm -rf apps/writer/node_modules/.vite node_modules/.vite
pnpm -C apps/writer dev --port 5327
# In another terminal; intentionally no CHROME override:
env -u CHROME BASE=http://127.0.0.1:5327/ pnpm -C apps/writer test:browser
```

Both suites passed **52 scenarios from a cold cache**, including manuscript adoption, typesetting and Word export. Repeated the cold-cache audit after final code/checks: again 52 passed, and the fresh Vite log contained no late dependency-discovery/reload events. The cache metadata includes all four declared entrypoints. `pnpm check` (65 core / 161 Writer tests, 12 script passes / 2 gated skips), performance TypeScript checking and manifest validation also passed. These runs used installed beta.124; the coordinator's candidate-tarball canary itself was not run here.

No LAB, production collection, release, deployment or canonical checkout was changed.
