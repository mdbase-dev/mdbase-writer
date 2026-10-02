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
pnpm build
```

The `?demo` collection runs on the SDK's in-memory record authority
(`@mdbase-dev/connect-testing`), so record sessions, autosave, conflicts, and recovery use the
same SDK paths as a real collection. It is enabled in development and LAB builds, not staging
or production. Demo changes are not durable collection data.

The browser suite needs Chromium plus the `pandoc` and `unzip` CLIs to inspect downloaded
Word and bundle exports. CI installs all three; install the CLIs with your system package
manager and Chromium with `pnpm --filter @mdbase-writer/app exec playwright install chromium`.
Run the end-to-end Chromium suite with `pnpm dev` running:

```sh
pnpm --filter @mdbase-writer/app test:browser
```

If port 5320 is occupied, use `pnpm dev --port 5321` and run both suites with
`BASE=http://127.0.0.1:5321/ pnpm --filter @mdbase-writer/app test:browser`.
Stop the development server after testing.

This runs the baseline suite and fault-injection checks for recovery, early exports, chapter
history, conflicts, cancellation and selectable preview text. Run only the latter with
`pnpm --filter @mdbase-writer/app test:browser:reliability`.

The existing browser acceptance coverage uses the demo collection, including the LAB deployment.
Acceptance against a real Connect collection has not yet been recorded in the architecture notes.
Do not treat demo coverage as proof of connected-collection behaviour.

## Against a real collection

The hosted mdbase Connect service accepts applications served over HTTPS only, so a localhost
build cannot use it. Either run Connect's local environment (`pnpm dev:environment:up` in the
`mdbase-connect` checkout, then open Writer with `?server=<local connect URL>`), or deploy a build
to an HTTPS origin and set `MDBASE_WRITER_ORIGIN` when writing the manifest:

```sh
MDBASE_WRITER_ORIGIN=https://writer.example pnpm --filter @mdbase-writer/app build
```

`VITE_MDBASE_CONNECT_URL` and `VITE_MDBASE_CONNECT_LOOPBACK_URL` select the Connect service
and local connector (defaults: production and port 28485).

Use a disposable test collection and review Writer's access and collection setup before approval.

## CI and GitHub deployment setup

`.github/workflows/ci.yml` runs on pull requests, main pushes, and merge groups. It installs
with a frozen lockfile, runs `pnpm check`, builds production, and runs both Chromium suites
against `pnpm dev` with a cold Vite dependency cache and the in-memory `?demo` collection.
This matches the consumer canary and catches deferred worker imports that reload/reset the demo.
Both suites run even when the baseline fails; browser screenshots are uploaded on failure. Demo coverage does not prove real Connect
collection behaviour.

Use **Actions → Deploy Writer → Run workflow**, branch **main**, target **staging** first.
Validate staging with a disposable collection, then dispatch **production** and approve the
production environment. The workflow reruns CI, deploys a fresh checkout through
`scripts/deploy-pages.mjs`, preserves its clean-tree guard, and verifies the live manifest.
No laptop login or dirty-tree override is needed. This follows Reader's explicit promotion
model: staging success is not programmatically bound to a production SHA, so reviewers must
check the run's commit against the validated staging commit before approving.

Repository administrators must configure:

- GitHub environments **writer-staging** and **writer-production**, with deployment branches
  restricted to **main**. Require reviewers for production, prevent self-review, and disable
  protection-rule bypass where supported. Staging may also require approval.
- In each environment, secrets **CLOUDFLARE_API_TOKEN** (account-scoped **Cloudflare Pages: Edit**)
  and **CLOUDFLARE_ACCOUNT_ID**. These are the only deployment credentials; CI uses none.
- Keep the existing Pages project **mdbase-writer**, production branch **main**, custom domain
  **writer.mdbase.dev**, and staging branch alias **staging.mdbase-writer.pages.dev**. Disable any
  separate Cloudflare Git-triggered production deployment if configured, so it cannot bypass
  the workflow gate.
- Keep the existing **mdbase-writer-assets** R2 bucket and compiler objects available to the
  `WRITER_ASSETS` Functions binding. This workflow does not upload or replace compiler assets.
- Require the CI job **Check, production build and Chromium** in the main branch ruleset
  (confirm the displayed check name after its first run). `merge_group` supports enabling a
  merge queue without losing the required check.

Deployment secrets/settings are not created by this change. Enable the required CI check only
after the first run is green; existing browser regressions must be fixed, not skipped.

## Deploy locally

Local commands remain available for deliberate operator use. Prefer the protected GitHub
workflow for staging and production.

Deployments are Cloudflare Pages branches of the `mdbase-writer` project. Targets are defined in
`apps/writer/scripts/deployment-environment.mjs`:

```sh
pnpm --filter @mdbase-writer/app deploy:lab       # https://lab.mdbase-writer.pages.dev, lab Connect, connector 28487
pnpm --filter @mdbase-writer/app deploy:staging   # https://staging.mdbase-writer.pages.dev, staging Connect, connector 28486
pnpm --filter @mdbase-writer/app deploy:prod      # https://writer.mdbase.dev, production Connect, connector 28485
```

Staging and production refuse to deploy uncommitted changes
(`MDBASE_WRITER_ALLOW_DIRTY=1` overrides). Only LAB serves the demo collection at `?demo`.

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
| `apps/writer`        | Web app: Connect session, record-session workspace, compile worker, CodeMirror editor, and canvas preview.                                                                         |
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
