# Large-collection SDK benchmark

Run from the repository root:

```sh
pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
PERF_RUNS=3 PERF_LATENCY_MS=20 pnpm -C apps/writer exec vitest run --config scripts/perf/vitest.config.ts
```

The opt-in benchmark uses the retained SDK's MemoryReplica and the same Writer
backend as the demo and connected application. It measures fixture seeding,
Home discovery, opening a record, scoped source annotations and external refresh.
Public SDK methods are instrumented only for simulated latency and response size.

Settings: `PERF_RUNS` (default 1), `PERF_LATENCY_MS` (default 20),
`PERF_OUTPUT` (default `out/perf/large-collection.json`).
The fixture counts live in `generator.ts`; the DEV `?demo=large` route reuses it.

These are Node proxies, not browser paint, production runtime or hosted-service
acceptance. Earlier legacy-query reports used a different transport and metric
set and must not be treated as directly comparable. The legacy authority-feature,
strict-contract and file-page toggles are removed with that client.
