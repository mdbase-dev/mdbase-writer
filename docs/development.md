# Developing mdbase writer

For using Writer, start with the [README](../README.md). This guide covers local development,
testing, deployment, and repository layout.

## Getting started

Use Node.js 22.12 or newer within the Node 22 release line and pnpm 11.15.1
(the version pinned in CI; older pnpm versions cannot read this lockfile's patch metadata).
From the repository root:

```sh
pnpm install
pnpm dev                 # http://127.0.0.1:5320/?demo — a demo collection, no account needed
pnpm check               # typecheck and tests (core, app, manifest)
pnpm build:production    # or: pnpm --filter @mdbase-writer/app build:staging | build:lab
```

A Writer build must name its environment (`VITE_MDBASE_ENV=lab|staging|production`); plain
`pnpm build` refuses rather than default to production. Each SDK original packages exactly one
environment's Connect trust, so the lab, staging and production originals are installed side by
side (`@mdbase-dev/sdk-lab`, `@mdbase-dev/sdk-staging`, `@mdbase-dev/sdk`) and
`apps/writer/scripts/writer-sdk.mjs` aliases the build to the verified original for its
environment. A Connect URL that disagrees with the environment is refused, and every targeted
build ends with `scripts/verify-connect-target.mjs`, which fails unless the bundle's only Connect
origin is that environment's.

`index.html` loads `src/main.tsx`, which constructs the SDK application for the selected environment. `App` renders `SdkWriterRoot`, then `NativeWriterView` / `NativeWriterBackend`. Sign-in, collection selection and approval belong to the SDK and shared UI. There is no legacy Connect client entry.

The `?demo` collection uses `createTestApp` / `MemoryReplica` from `@mdbase-dev/sdk/testing`, with the same NativeWriterBackend and SDK sessions as real collections. It is enabled in local development and explicit test builds (`VITE_WRITER_DEMO=1`); ordinary LAB, staging and production builds compile the demo import out. `?demo=large` adds the generated perf collection in development only. Demo changes reset on reload. Local development without `?demo` uses the LAB SDK entry.

Writer retains the direct `@mdbase-dev/connect-protocol` file pin solely for the publisher's authenticated-original comparison and cloud-ops repin ownership. Application and manifest validation imports use the SDK. Cloud-ops `tools/sdk-repin/archive.mjs` currently requires Writer's direct protocol pin and advances it with the SDK's bundled protocol bytes; removing it requires updating that automation and the publisher together. The publisher tests intentionally keep verifying this byte identity.

The browser suite needs Chromium plus the `pandoc` and `unzip` CLIs to inspect downloaded
Word and bundle exports. CI installs all three; install the CLIs with your system package
manager and Chromium with `pnpm --filter @mdbase-writer/app exec playwright install chromium`.
Run the end-to-end Chromium suite with `pnpm dev` running:

```sh
pnpm --filter @mdbase-writer/app test:browser
# Explicitly disable the HTTP cache and bypass service workers in both Chromium suites:
COLD_CACHE=1 pnpm --filter @mdbase-writer/app test:browser
```

If port 5320 is occupied, use `pnpm dev --port 5321` and run both suites with
`BASE=http://127.0.0.1:5321/ pnpm --filter @mdbase-writer/app test:browser`.
Stop the development server after testing.

This runs the baseline suite and fault-injection checks for recovery, early exports, chapter
history, conflicts, cancellation and selectable preview text. Run only the latter with
`pnpm --filter @mdbase-writer/app test:browser:reliability`.

Run `pnpm --filter @mdbase-writer/app test:browser:polish` against the same local server
for the eight-context desktop/phone, light/dark and normal/Reduce matrix. It samples actual
`document.getAnimations()` targets and rAF trajectories for 160 ms entrances, 120 ms exits,
interruption, reversal and runtime Reduce cancellation. Coverage includes the retained lower
sidebar panel, its keyboard tabs and focus return, preview Fit containment, information-text
contrast, Find/Replace, and demo-only save/reset identity. Non-loopback requests are blocked.
These are Chromium viewport fixtures, not real-account or physical-phone qualification.

The same polish command also exercises native SDK in-memory records in all eight contexts:
offline/local-only save feedback remains visible in Write mode, held versions cannot offer
an unsupported comparison, local drafts can be downloaded, and ordinary concurrent edits
can be compared and deliberately merged. The native fixture uses the SDK hold-resolution
path to clear its test hold; Writer does not bypass native protection. Preview containment
is asserted while Preview is selected, not only after returning to Write. The workspace's
main landmark, manuscript heading, divider regions and phone toolbar hit areas are checked
alongside these interactions. Screenshots and the result matrix are in `apps/writer/out/polish-r2/`.

The cursor/undo/redo regression also runs against optimized production React with a real
compiler and Preview canvas (development React can hide update-scheduling failures):

```sh
pnpm --filter @mdbase-writer/app build:editing-test
pnpm --filter @mdbase-writer/app test:browser:editing
```

This test starts and closes its own loopback server, serves the installed compiler WASM,
and blocks external requests. Its demo-enabled bundle is a test fixture, not a deployment artifact.

The existing browser acceptance coverage uses the demo collection, including the LAB deployment.
Acceptance against a real Connect collection has not yet been recorded in the architecture notes.
Do not treat demo coverage as proof of connected-collection behaviour.

## Private feedback acceptance

Build the explicit local fixture, then serve it on the feedback test's loopback port:

```sh
pnpm --filter @mdbase-writer/app build:feedback-test
pnpm --filter @mdbase-writer/app exec vite preview --host 127.0.0.1 --port 8892 --strictPort
# In another terminal:
pnpm --filter @mdbase-writer/app test:feedback
```

This build opts into the in-memory demo with `?demo`, including with the LAB environment
selected. Bootstrap does not create a native account entry for that explicit demo; ordinary
LAB URLs still use the SDK, and grant-return callbacks take precedence. The unchanged test
checks desktop/mobile feedback, focus and draft restoration, redacted diagnostics and
consented payloads. All feedback delivery is intercepted. Do not deploy this fixture build:
its feedback endpoint is loopback, and it is not connected-collection acceptance evidence.

## Against a real collection

Use an environment-specific HTTPS build (`build:lab`, `build:staging` or `build:production`). The verified SDK original owns Connect trust and connector routing; URL parameters and `VITE_MDBASE_CONNECT_*` overrides do not retarget it. Real collection acceptance belongs in an isolated registered LAB deployment.

Use a disposable test collection and review Writer's access and collection setup before approval.

## CI and GitHub deployment setup

`.github/workflows/ci.yml` runs on pull requests, main pushes, and merge groups. It installs
with a frozen lockfile, runs `pnpm check`, builds production, and runs both Chromium suites
against `pnpm dev` with a cold Vite dependency cache and the in-memory `?demo` collection.
This matches the consumer canary and catches deferred worker imports that reload/reset the demo.
Both suites run even when the baseline fails; browser screenshots are uploaded on failure. Demo coverage does not prove real Connect
collection behaviour.

Staging and production follow [Writer continuous deployment](continuous-deployment.md)
through ops `bin/release`: newest exact-commit green main → staging → fresh-browser
smoke → production → smoke, with automatic predecessor Pages recovery on production
failure. There is no per-publish approval, production reviewer, native release branch,
dirty-tree override or laptop deployment for either target. Main can move during a run.
The protected environments retain their existing Cloudflare secrets and require the
raw per-target `WRITER_TRUST_ASSET_SHA256`; see that runbook for the exact settings,
App grant, retired policies/variables and supervisor-owned live proof.

Keep the existing `mdbase-writer` Pages project, main production channel,
`writer.mdbase.dev`, `staging.mdbase-writer.pages.dev` and `WRITER_ASSETS` R2 binding.
Keep normal main protection and the required **Check, production build and Chromium**
CI job. No settings or secrets are created by source. Separate Cloudflare Git-triggered
publishing must remain disabled so it cannot bypass the guarded publisher.

## Deploy locally (LAB only)

Only the LAB deployment helper remains. It builds against the LAB SDK/Connect
origin and allows the in-memory demo; staging/production refuse this route.

```sh
pnpm --filter @mdbase-writer/app deploy:lab
```

The Typst compiler (28 MB) and Pandoc (58 MB) exceed Pages' 25 MiB file limit. They live in the
R2 bucket `mdbase-writer-assets`, and `apps/writer/functions/wasm/[name].ts` serves them on the
same origin with Brotli compression and immutable caching. About 9.8 and 16 MB are transferred;
Pandoc downloads only on the first Word export.

Upload new versions when typst.ts or pandoc-wasm is upgraded:

```sh
pnpm --filter @mdbase-writer/app upload:compiler
```

Word styles are generated from Pandoc's default reference document:

```sh
node apps/writer/scripts/reference-docx.mjs
```

This command needs a local Pandoc installation.

## Repository layout

| Path                 | Purpose                                                                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/core`      | Markdown dialect (Lezer), per-record Typst translation with source maps, incremental citeproc with a Typst output format, manuscript assembly, and Pandoc materialisation. No DOM. |
| `apps/writer`        | Web app: SDK application, record-session workspace, compile worker, CodeMirror editor, and canvas preview.                                                                         |
| `apps/writer/typst`  | Typst runtime: helper library and the `article` and `thesis` templates.                                                                                                            |
| `apps/writer/mdbase` | Type pack: the `dev.mdbase.writer.manuscript` contract and starter type, Reader's source contract and type, and the comment pack.                                                  |

## Data and custom layouts

A manuscript is an ordinary Markdown record implementing `dev.mdbase.writer.manuscript`.
Chapters are Markdown records embedded on lines of their own with `![[path]]`.
Reader sources implement `dev.mdbase.reader.source`; their `csl` field holds CSL-JSON, with
`csl.id` as the citekey. Citations follow Pandoc syntax; labels and cross-references follow Quarto.

Citation formatting uses citeproc-js in the preview and Pandoc's citeproc for Word output.
Six styles and eight CSL locales are bundled. A manuscript's `csl` can also name a `.csl` file
in the collection; `lang` selects its locale.

The preview is typeset with Typst in a Web Worker, drawing only pages near the viewport.
Alongside the article and thesis layouts, a manuscript can use a `.typ` file in the collection
that defines:

```typst
template(title:, subtitle:, authors:, abstract:, date:, body)
```

A collection template is one file: its imports are not loaded. It affects PDF only; custom
layouts use article styles for Word export.

See [the architecture notes](architecture.md) for data contracts, comments and suggested edits,
record sessions, source maps, compilation, export materialisation, performance measurements,
and [known limits](architecture.md#known-limits).
