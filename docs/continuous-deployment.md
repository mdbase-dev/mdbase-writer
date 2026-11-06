# Writer continuous deployment

Writer uses the independent app line in `mdbase-dev/mdbase-cloud-ops`, through
`bin/release app-cd`. The 2026-11-06 maintainer decision replaces Writer's native
publisher with Editor-style verification. No per-publish GO, production reviewer,
owner handoff or release branch remains. This decision does not change any other
app's authorization or Desktop's 24-hour release gap.

`ci.yml` checks PRs and main. `deploy-writer.yml` publishes only by dispatch on
**main**, with `target=staging|production` and exact 40-hex `source_sha`. Source must
be a clean main ancestor, not the current head. Moving main during a run is safe.
Ops selects the newest exact-commit green main source, skips already-live
production, stages and smokes it, then publishes and smokes production. Server
compatibility refusals quietly wait for a later poll. An app failure holds Writer
only; other app lines and Server CD remain independent.

## Authenticated inputs

All helpers in protected jobs come from the workflow's main SHA. The candidate
is a separate checkout and is read only as data there. Unprivileged builds have
no GitHub environment, deployment token, OIDC grant or persisted checkout token.
The protected uploader never installs or executes application dependencies.

- Find the unique `vendor/sdk-production-*.json` record matching the manifest's
  original SDK archive. Verify its length, SHA256, SHA512, frozen importer and
  archive resolution, packaged trust module, native/SQLite bytes, bundled
  dependencies and runtime provenance.
- Verify the exact npm version's archive integrity **and** Sigstore provenance,
  including `mdbase-dev/mdbase-connect`, `publish-sdk-npm.yml`, committed source
  ref and producer commit. No unsigned or prior-off-CI exception exists.
- For staging, download that **same version's** `sdk-vVERSION/sdk-staging.tgz`
  and `.sigstore.json`, verify both release asset digests and `gh attestation
  verify` with exact repository, signer workflow, source ref and producer digest.
  Mechanically derive the frozen install by changing only the SDK archive,
  integrity, actual `@mdbase-dev/sdk-staging` file-alias and peer identity.
  Application imports stay `@mdbase-dev/sdk`; no archive is repacked or retargeted.
  Older LAB/developer staging archives are not publication inputs.
- Both targets require the SDK's packaged trust/provenance, the contract in
  `config/sdk-publication.json`, the **raw signed** `config/next-trust/TARGET.json`
  and protected `WRITER_TRUST_ASSET_SHA256` to agree. No trust key is generated,
  replaced or authenticated by a mere self-consistent pin edit.
- The direct protocol must be byte-identical to the one bundled in the
  authenticated SDK, in both environments. The direct beta.145 archive in this
  change is copied from Writer's existing beta.156 SDK. The ops repinner now
  advances SDK/protocol pins together, like Editor.
- UI is an exact npm version with frozen SHA512. Its existing reviewed
  `patches/@mdbase-dev__ui@0.1.0-beta.147.patch` remains: validate its frozen SHA256,
  apply it to an isolated copy of the verified registry original, then compare
  every installed member. SDK/protocol comparisons have no patch exception.
  Dependencies are installed with lifecycle/pnpmfile hooks disabled; installed
  inventories precede dependency execution.

## Upload, smoke and recovery

Build once. Vite app entry filenames carry the source's first twelve characters,
so monitor/smoke can identify the actual served code. Bind the complete immutable
artifact ID/digest, exact run/attempt, workflow SHA, source/tree, target, plan and
inventory before upload. Workflow SHA and candidate SHA deliberately differ when
main has moved. A rerun cannot publish again; reconcile and use a fresh run.

Unlike Editor's static project, Writer has Pages Functions limited to `/wasm/*`.
The unprivileged build precompiles them with the isolated official Wrangler lock.
The protected job retains Writer's source-owned route, compatibility-date and R2
binding policy, actual deployment metadata, official compiler archive hashes,
served WASM bytes and conditional/404 behavior checks. It never uploads to R2,
executes candidate Functions during upload, provisions a project or records raw
API/Wrangler payloads. Existing `mdbase-writer` must use production channel main.

Immediately before upload, a workflow-owned compatibility step takes the
**authenticated SDK producer** and proves it is an ancestor of both actual live
production revisions: `connect.mdbase.dev/health.revision` and
`sync.mdbase.dev/ready.provider.revision`. Semver or desired release pins are not
a proof. A mismatch or unavailable read records `production-contract-wait`,
skips upload/smoke and lets ops quietly wait. Ops repeats the same gate before
staging and production, and requires its own same-run staging smoke receipt.

Verify every served static byte and Writer's distinct runtime/hosting controls on
the immutable deployment URL, then the alias. Only the alias has a bounded settle
window. A separate credential-free Playwright job opens a fresh Chromium context,
disables cache and service workers, checks the source-bearing entry script and
reaches Sign in. Page errors and `readiness_fenced` fail. Cross-origin injected
module scripts, including Cloudflare Insights, are filtered out of entry identity.
Smoke emits fixed reason codes only, never raw logs, storage, account data or
browser diagnostics.

Before production upload, store the previous Pages UUID and a fingerprint
snapshot of its alias, shell and transitive static resources as a separate
artifact. On incomplete publication, failed smoke or cancellation, a separate
protected recovery job restores that exact UUID only if the active deployment
belongs to this run's source, then verifies the saved bytes over a stable
interval. Another source's deployment is not overwritten. Successful recovery
**does not** turn publication green: ops opens an `app-stop` issue marked
`<!-- mdbase-app-line:writer -->`. Failed/unverified recovery uses the fixed text
**PRODUCTION ROLLBACK FAILED OR UNVERIFIED.** Unknown writes are never redispatched
or retried automatically. Staging does not roll back.

Retain bounded plan/authentication, complete artifact/inventory, static/runtime
verification, smoke, compatibility and recovery evidence for 90 days. The
supervisor completes the privacy-bounded deployment report in ops after each
attempt. These checks establish publication and sign-in readiness, not signed-in
account/device/file-operation acceptance.

## Supervisor setup (not performed by source)

For `writer-production` and `writer-staging`, retain the protected environments
and existing `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` secrets. The token
needs Pages read/edit, deployment rollback and the existing Functions/R2 binding
configuration; no credential moves or new trust keys. Admit branch **main only**
(no tags), with no required reviewers or wait timer. Remove staging
`release/native-staging`, and production `release/native-production` and
`release/legacy-query` deployment-branch entries; their publishers are deleted.
Keep ordinary main protection and normal CI.

Set **`WRITER_TRUST_ASSET_SHA256`** as an environment variable:

| Environment | Raw signed asset SHA256 |
| --- | --- |
| `writer-production` | `7912e40838213e60b65848350d319a48019021317b112e3326429b250f0133d7` |
| `writer-staging` | `18ae86a26f9c8b2442235c537b8d58dcc059c05e4bb0f175607fd0aeacc3f0ad` |

These come from Connect `config/release-components.json` →
`sdkPublication.environments`, checked against the raw target files, copied
unchanged to this repository. They are not module/context/receipt hashes.
Production's bytes are unchanged; staging's new issuance/source changes neither
roots nor policy keys nor authority origins from Writer's retired staging asset.
Remove `NATIVE_SDK_SHA256`, `NATIVE_UI_SHA256`, `NATIVE_PROTOCOL_SHA256` and
`NATIVE_TRUST_ASSET_SHA256` from both environments. Unused release branches may be
retired after confirming external consumers; source does not change branches.

The release App must include Writer, with **Actions write** for dispatch and
workflow/artifact reads and Contents read for source/ancestry. Its existing
organization grants already include Actions write, and Writer repin PRs show
prior access; the supervisor must confirm current selected-repository membership.
Ops reuses its existing App key to mint an app-scoped Writer dispatch/read token
and a separate ops/Connect read-only evidence token. No App key is copied here. This workflow's own token stays read-only; ops writes app holds with its
separate job token. See ops `docs/app-continuous-deployment.md` for the exact
webhook filter, merge order and live-proof checklist.

## Local checks

CI and the publisher use Node 24, matching the authenticated npm/Sigstore
rehearsals. Ordinary development also supports Node 22.

```sh
rpnpm --node 24.19.0 check
rpnpm --node 24.19.0 test:publisher
rpnpm --node 24.19.0 test:publisher:build production FULL_SHA
rpnpm --node 24.19.0 test:publisher:build staging FULL_SHA
```

Rehearsals authenticate real public SDK inputs, derive staging's frozen install,
build real Writer/Functions and validate the complete inventory without uploading.
They need Node 24's npm Sigstore and, for staging, `gh`; the shared builder passed
both. They are not dispatch admission or live smoke/rollback proof. Direct local
`deploy-pages.mjs` remains LAB-only; staging/production refuse that old route.
