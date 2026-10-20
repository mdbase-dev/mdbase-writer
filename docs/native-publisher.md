# Protected native Writer publisher

`deploy-writer.yml` retains its existing main-only route when `source_sha` is
blank. A nonempty `source_sha` selects a separate manual-only native route.
There is no push trigger, PR credential path, rebuild-after-upload, rollback or
redeploy. Pages channel `main` means the production slot, not a Git main merge.

## Required operator prerequisites (not configured by this change)

- Reviewed, protected `release/native-staging` / `release/native-production`
  branches descended from the qualified native integration. Each carries its own
  target-specific SDK/UI/protocol archive pins **and frozen lockfile intake**.
  Never replace SDK bytes under an old lock or reuse/retarget the LAB archive.
- Existing GitHub environments `writer-staging` and `writer-production`, with
  exact allowed native branch policies (retain existing main route policies).
  Production must require the authorized reviewer, prevent self-review, disable
  admin bypass, and have separate Callum GO **before any production dispatch**.
  Workflow YAML cannot create or prove these settings. No approval bypass exists
  in this publisher. The environment/branch protection owner must verify them.
- Environment secrets (names only): `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`. The token needs existing Pages deploy and deployment
  metadata read access for `mdbase-writer`; no credentials reach install/test/build.
- Environment variable `WRITER_NATIVE_TRUST_SHA256`: the lowercase SHA-256 of the
  exact target descriptor below, approved **independently** after TNAPP/canonical
  producer authentication of the original archives. Do not populate it from the
  candidate checkout's own claimed hashes. Do not use a repository-level fallback
  variable. This public digest is an approval pin, not a new signing key or a
  substitute for producer signature/provenance verification.
- Existing optional feedback variables: `MDBASE_FEEDBACK_URL` and
  `MDBASE_FEEDBACK_TURNSTILE_SITE_KEY`.

No target descriptors or SDK repins are supplied here. Both targets currently
refuse before install/build/upload. Source readiness is not deployment approval.

## Target descriptor intake

Commit `apps/writer/vendor/native-sdk-trust.<target>.json` on the corresponding
release branch. Schema (replace placeholders only with authenticated originals):

```json
{
  "environment": "staging",
  "trustEnvironment": "staging",
  "appOrigin": "https://staging.mdbase-writer.pages.dev",
  "connectOrigin": "https://connect-staging.mdbase.dev",
  "editorOrigin": "https://editor-staging.mdbase.dev",
  "archives": {
    "sdk": { "path": "vendor/<original-sdk>.tgz", "sha256": "<64 lowercase hex>" },
    "ui": { "path": "vendor/<original-ui>.tgz", "sha256": "<64 lowercase hex>" },
    "protocol": { "path": "apps/writer/vendor/<original-protocol>.tgz", "sha256": "<64 lowercase hex>" }
  }
}
```

Production substitutes only genuine production originals, environment
`production`, Writer `https://writer.mdbase.dev`, Connect
`https://connect.mdbase.dev`, and Editor `https://editor.mdbase.dev`.
Paths must be canonical repository-relative regular files matching the app's
`file:` dependency pins. Symlink inputs are refused. Frozen install checks lock
consistency. The independently pinned descriptor binds all three archive hashes.

The guard reads (never executes or extracts) the SDK's canonical generated
`dist/application/packaged-trust.js` metadata, checking the embedded environment,
CP origin, release asset hash and source identity. Log origin comes only from
that authenticated SDK context, not an app override. Unknown metadata layouts
fail closed; coordinate any adaptation with the canonical producer. The guard
also records SDK native member hashes for `runtime.wasm`, `sqlite3.wasm`, and
`sqlite3.js`; the built inventory must contain their exact original bytes.

## Publication contract

The dispatch must select the literal target release branch and request its full
40-lowercase-hex publication **HEAD** SHA. Ancestors are deliberately refused.
The event ref/SHA and fetched publication HEAD must all agree. A moving branch
causes refusal, not fallback. The checkout must be exact and clean; source and
archive checks repeat after the frozen install/tests before the single build.

The native path runs `pnpm check`, then one `pnpm build` with exact target
Writer/Editor/Connect origins, no native loopback and demo disabled. The existing
strict canonical manifest validator runs during build and on the built manifest;
additional checks bind its homepage/redirect/installation origin to the target
and preserve the `/wasm/*` Functions scope. Legacy deployment steps are unchanged.

Before upload, every built regular asset receives a size and SHA-256 inventory;
symlinks, duplicates, missing native bytes or files over Pages' 25 MiB limit fail.
After one upload using the existing Wrangler 4.120.0 command, the publisher reads
Cloudflare deployment metadata and resolves the **actual deployment UUID**, bound
to the unique upload URL, full source SHA and Pages channel. A URL prefix is not
claimed as the deployment ID.

A separate credential-free verifier reads the saved pre-upload inventory and
checks the real staging alias/custom domain. Every served asset is compared,
including HTML, manifest, all JS (including bundled trust), source maps, native
WASM and SQLite. Only Pages control files/worker modules are non-fetchable;
they remain in the inventory. HTML uses Pages' clean URLs. Custom 404 bytes may
return 404, but redirects/login pages never pass. No Access/auth bypass is used.
Verification is limited to six passes, 1,024 assets, 25 MiB per asset, 15 seconds
per request and a four-minute total deadline, with bounded streaming reads.

The run retains plan, full inventory, deployment metadata, verification and
receipt artifacts for 90 days, including failure evidence. The receipt records
source SHA/tree, archive hashes, embedded trust environment/CP/log/release
binding, built-asset digests and deployment UUID. Missing ID or failed served
bytes means `failed-or-incomplete` and a failed job. No rollback/redeploy follows.
Artifact retention is not permanent archival; the release owner must preserve
qualified receipts longer if required. These receipts do not establish native
sign-in/grant/readiness or Writer behavior admission.

## Offline checks

```sh
node --test apps/writer/scripts/native-publisher.test.mjs
rpnpm check
rpnpm build
actionlint .github/workflows/deploy-writer.yml
```

The dependency-free Node suite uses temporary Git/archive/fetch fixtures, never
real credentials or deployments. `rpnpm` runs the full tests/types/build remotely.
Do not claim a successful generic build as a target-authenticated native build;
that remains blocked until real target intake and environment protection exist.
