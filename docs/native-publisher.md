# Protected native Writer publisher — source only

The blank `source_sha` main-only route is unchanged. A nonblank SHA selects the
manual native route from `release/native-staging` or `release/native-production`.
Full lowercase 40-hex dispatch/event/checkout/ref HEAD must agree; ancestors and
moved HEADs refuse. Pages channel `main` is not a Git main merge.

## Authority and external gates

NX-TRUST/TNAPP perform normal private Ops full-chain authentication **once,
off-CI**. CI checks custody/original bytes, not fresh Sigstore, expiry, signing,
SDK qualification, admission or deployment authority. No new public tool/API,
authentication flag, helper image or authentication gate is introduced.

The protected per-environment variables are exactly:

- `NATIVE_SDK_SHA256`: unchanged original SDK tgz.
- `NATIVE_UI_SHA256`: unchanged original UI tgz.
- `NATIVE_PROTOCOL_SHA256`: unchanged original protocol tgz.
- `NATIVE_TRUST_ASSET_SHA256`: **RAW signed `next-trust/<target>.json`**; equal to
  authenticated release inventory `trustAssets[0].sha256`, context `context.sha256`,
  SDK provenance `trust.sha256` and compiled `appReleaseTrust().assetSha256`.
  It is NOT the module, context, receipt or native/archive hash.

Values must come from the authenticated owner handoff and protected environment,
not candidate defaults, a repository variable fallback or an approval descriptor.
Module integrity is independently bound as an original archive member. YAML
cannot prove variable scope or environment/ref protections: parent must inspect
those externally. The old descriptor variable/schema is removed.

Required external settings, **not configured or inspected here**:

- Reviewed immutable, protected native release refs carrying independently
  accepted SDK/UI/protocol originals and matching frozen lock intake.
- `writer-staging` / `writer-production`, exact native branch policies, no admin
  bypass. Production requires **Callum as reviewer**, **NOT prevent-self-review**.
  Separate Callum GO is required BEFORE any production dispatch or tag. Human UI
  approval only; agents never call deployment-approval APIs or publish hashes as
  substitute approval. Retain existing main route policies.
- Existing environment secrets, names only: `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, with the existing Pages deploy/metadata-read scope for
  `mdbase-writer`. No secrets reach the app install/test/build job.
- Authenticated exact target packet, public source/qualification/evidence
  references and accepted producer facts carried by the reviewed immutable source.

Missing/unknown originals fail closed. Current frozen LAB SDK/UI/protocol/native
pins are unchanged. No target repin/packet, LAB retarget or production GO is
supplied. Candidate B, Editor pairing, exact origins, no native loopback and demo
OFF are unchanged. A generic current-LAB build is NOT native target qualification.

## Canonical delivery layout (not a new authority/schema)

`apps/writer/vendor/native-release/<target>/` holds the unchanged producer
`artifact-facts.json`, `members.json`, `provenance.json`, `build-receipt.json`,
`next-trust/<target>-context.json`, `next-trust/<target>.json`,
`release-trust-bundle.json`, `release-trust-bundle.sigstore.json`,
`image-release-bundle.json`, `image-release-bundle.sigstore.json`.
`build-receipt.json` is only this delivery filename for the existing
`mdbn-sdk/application-build/1` receipt. No field aliases are invented.

Contract: TNAPP public target-SDK verification-input handoff (inbox878), including
`mdbn-sdk/application-assets/1` provenance, canonical facts/dependency/member
fields and original context/receipt/proof/run bindings. Archives remain at their
existing app `file:` pins; no archive filenames are synthesized or repacked.

Before candidate package code executes: hash ALL three originals, check frozen
importer/file pins and SHA512 integrity; safely inventory every regular original
member without extraction/execution; compare producer SDK complete inventory and
byte-identical provenance; canonical native producer repository is
`mdbase-dev/mdbase-next` (distinct from Connect trust source
`mdbase-dev/mdbase-connect`). Facts dependency `file` is SDK-relative
`vendor/<original-protocol>.tgz`: bind that exact archived original tgz AND all
bundled/installed protocol members, not a basename/path alias. Bind raw asset,
target/CP/log/source, release/image
inventory and publication/qualification IDs, frozen receipt/verifier identity,
compiled trust literal, native/SQLite hashes/budgets and bundled protocol original.
The install is frozen with scripts and pnpmfile hooks disabled. Then compare ALL
installed SDK/UI/protocol members, including bundled originals, to original
inventories before rebuild/tests/build. Missing/extra/tampered/symlinked original
members refuse. Proof copying is byte binding, not full-chain authentication.

## Job boundary and EXACT deploy-tool choice

1. `native-dispatch`: literal target/native ref and exact event SHA, no checkout.
2. `native-inputs`: protected environment, no checkout/candidate execution or
   secret references; emits only the four public hash expectations.
3. `native-build`: **no GitHub environment and no Cloudflare secrets**. Clean exact
   checkout, frozen original/install checks, `pnpm check`, one target app build,
   strict canonical manifest validation, then Pages Functions **precompilation**.
   Exact Writer/Editor/Connect origins, no loopback, demo OFF. Offline shell and
   generated workers are complete before full inventory/envelope generation.
4. `native-deploy`: protected environment, reviewed source checkout, **NO app
   dependencies, project hooks/build or artifact-provided scripts**. Independently
   installs official **Wrangler 4.114.0**, from the checked-in dedicated minimal
   `tools/native-publisher/{package.json,pnpm-lock.yaml}` with transitive integrity
   hashes, `--ignore-workspace install --frozen-lockfile --ignore-scripts --ignore-pnpmfile`, copied into a
   fresh `$RUNNER_TEMP/writer-tools` cwd outside the app/workspace; user/global npm
   configuration is `/dev/null`. No app `.npmrc`, workspace or app package install.
   This is approved official deploy-tool bootstrap, NOT SDK authentication; no
   preinstalled/prebundled tool is required. The lock was copied from existing
   official 4.114.0 cache, not dynamically resolved by the protected job.

Compiler CLI/`--no-bundle` and Pages configuration behavior were inspected in
cached official Wrangler4.114.0 source. Pages rejects `--config`; it discovers a
`wrangler.json` in its cwd. Without config, Wrangler deletes Worker bindings from
the upload bundle metadata. The protected job therefore generates an isolated
SOURCE-derived `wrangler.json` from existing `apps/writer/wrangler.jsonc`:
`WRITER_ASSETS` → `mdbase-writer-assets`, compatibility date `2026-09-27`, no flags,
for both preview and production. Only its output path changes to the immutable
artifact directory. It is NOT artifact-provided config. No functions, project
hooks or app install exist in this cwd. Build compiles Functions into `_worker.js`;
upload uses `pages deploy ... --no-bundle`, never project compilation. Offline
compatibility checks parse both channels with official4.114.0 `unstable_readConfig`
and precompile the existing Functions without deployment. All tool-install
lifecycle scripts stay disabled.

## Immutable artifact and deployment evidence

Build publishes one immutable ID/digest with target/run/attempt name, source/tree,
repository, plan and full inventory hashes. Upload validates GitHub artifact
ID/digest/repository/run/attempt/source and workflow dispatch/native branch;
hashes the ZIP before extraction, refuses unsafe/duplicate/link paths and limits,
then repeats metadata/digest checks after download. Downloaded source/tree/target,
plan and exact full inventory must match trusted source. The artifact additionally
contains the unchanged official Typst/Pandoc npm tgz DATA and `runtime.json`.
Build fetches only exact official registry URLs; root frozen lock SHA512/SRI and
app version pins independently anchor them. Protected upload re-derives the exact
original member sizes/SHA256/versioned URL paths without installing app packages
or executing archive code; the artifact's expectation JSON is never authority.
Only those two fixed data-archive paths are allowed, and the envelope binds the
runtime expectation file. No R2 uploads or repairs are performed. The upload directory is
read-only with no artifact process running; full inventory is asserted again
immediately before upload. The current remote exact native HEAD is rechecked as
the last guard before the one upload. These read-only GitHub calls are workflow
source, not actions performed during source qualification.

The inventory covers **all final bytes**, including `.well-known`, dot/underscore,
offline-shell/generated workers, `_routes.json` and precompiled `_worker.js`.
The shared dependency-free byte helper is copied UNCHANGED from Journal2007dc4:
SHA256 `a4336258cea726285573e9e667bba1c1ad6797fdba331715d0f17ea67ea5c66a`.
The built manifest stays target-bound and Functions scope stays `/wasm/*`.
Exact original runtime.wasm/sqlite3.wasm/sqlite3.js bytes are required.

After upload, resolve and save the actual deployment UUID bound to unique upload
URL/full SHA/channel **before** served checks. HTTP200, root marker, URL prefix or
GET of executing `_worker.js` source is not runtime/byte proof. Shared bounded
GET verification checks every servable asset, credentials omitted, strict trusted
same-origin mappings/redirect rules, bounded streaming sizes/retries/deadline
(maximum 180 seconds). Missing/tampered/redirected/oversized/timed-out assets fail.

### Trusted hosting/runtime policy (source implementation, mocked qualification)

The actual external compilers are Typst (~28 MB) and Pandoc (~58 MB), NOT SDK
runtime.wasm. Independently root-lock-bound originals supply exactly
`pkg/typst_ts_web_compiler_bg.wasm` and `src/pandoc.wasm`, served at the existing
versioned `/wasm/typst_ts_web_compiler-<version>.wasm` and
`/wasm/pandoc-<version>.wasm` URLs. The unchanged shared helper verifies ALL their
actual bytes/length/SHA256 together with all static assets under the same180s
whole-publication budget. The shared128MiB/file ceiling is retained; static
upload files still have Pages'25MiB ceiling.

Before upload, the workflow reads only the fixed project's API identity/config;
no alias is assumed to exist. After actual UUID capture, source code reads the
scoped deployment and project's selected `deployment_configs.preview|production`.
Only safe project ID/name/production-branch, compatibility date/flags, R2
binding/bucket names and deployment UUID/URL/source/channel/environment are
retained. No whole project, env_vars, tokens or secret values are persisted.
The project ID must stay identical across upload, name is `mdbase-writer`,
production branch is `main`, compatibility settings and sole R2 binding must
match source, and deployment/source/channel/UUID must match the captured upload.
These are documented existing GET endpoints/fields used by cached Wrangler;
no invented Worker source-download or approval API is used.

Actual WASM responses must have `application/wasm`, exact Content-Length,
`public, max-age=31536000, immutable` and a quoted ETag. ETag is NOT byte proof.
After full byte equality, bounded conditional GETs must return matching ETag with
empty304. Invalid names and a source-SHA-qualified missing object name must
return404 with exact `Not found` body. Missing/stale R2 objects fail closed;
there is no seeding/repair/retry-deployment permission. All probes share the
remaining180s budget and omit credentials/refuse redirects.

Only root `_routes.json` matching the trusted source byte hash and root compiled
`_worker.js` in the immutable upload inventory can receive **separate covered
hosting-control evidence**, after configuration/metadata/byte/behavior checks.
They are NOT put in the servable-byte `verified` array. Unknown `_headers`,
`_redirects`, nested/new route controls or Worker modules remain `unverified` and
BLOCK, as do all byte/header/route/metadata failures. No artifact-provided
`policy_verified` flag is accepted. Receipts require exact disjoint static-byte
and covered-control inventory, both original-bound runtime byte results, actual
UUID/source-bound metadata and all behavior evidence.

Proof limit: current project configuration + scoped deployment identity +
controlled immutable compiled-artifact/config upload + actual behavior is NOT a
public API proof of live Worker source bytes or historical per-deployment binding
snapshots. We do not claim one. Live metadata/alias/R2 behavior and actual official
archive intake have NOT been exercised by source-only mocked qualification.
Native target originals, external environment/ref/credential protections,
reviewed source activation and separate production GO remain real gates.

Retain run/source/artifact metadata, full inventory, UUID, verification and failed
receipt/log evidence for 90 days. Missing UUID, missing checks, or byte/control
failure produces `failed-or-incomplete`; never automatically rebuild/redeploy or
rollback. Longer evidence archival and real native admission remain external.

## Source-only checks

- `rpnpm run test:publisher`: focused guards, original/installed custody, artifact,
  shared-helper and blocking-control regressions, synthetic offline fixtures only.
- `rpnpm run typecheck`: existing supported workspace types.
- `rpnpm run build:publisher-compat`: actual generic app build ONCE, then isolated
  4.114.0 ignore-scripts tool install and offline Functions precompile compatibility.
- `rpnpm run test:publisher:tools`: standalone tool-only compatibility check;
  useful if app build already completed (do not rebuild the app for a tool fix).
- `actionlint .github/workflows/deploy-writer.yml`, `git diff --check`.

No deployment, remote approval/credential/ref/environment action, SDK/native
build, producer operation or LAB operation is authorized by these checks.
