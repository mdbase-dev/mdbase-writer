# Developing mdbase writer

For using Writer, start with the [README](../README.md). This guide covers local development,
testing, deployment, and repository layout.

## Getting started

Use Node.js 22.12 or newer within the Node 22 release line and pnpm.
From the repository root:

```sh
pnpm install
pnpm dev                 # http://127.0.0.1:5320/?demo — a demo collection, no account needed
pnpm check               # typecheck and tests
pnpm build
```

The `?demo` collection runs on the SDK's in-memory record authority
(`@mdbase-dev/connect-testing`), so record sessions, autosave, conflicts, and recovery use the
same SDK paths as a real collection. It is enabled in development and LAB builds, not staging
or production. Demo changes are not durable collection data.

Run the end-to-end Chromium suite with `pnpm dev` running:

```sh
pnpm --filter @mdbase-writer/app test:browser
```

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

## Deploy

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
