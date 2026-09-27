# mdbase writer

Write in Markdown in your mdbase collection; get a typeset PDF, with
citations from your mdbase Reader library.

mdbase writer is an application on mdbase connect. A manuscript is an
ordinary Markdown record. It cites sources with Pandoc syntax
(`[@citekey, p. 12]`), labels and cross-references with Quarto syntax
(`{#fig-results}`, `@fig-results`), and embeds other records on a line of
their own (`![[chapters/one]]`), so a book is a manuscript whose body embeds
its chapters. The preview is typeset by Typst in the browser as you type.

## What it does

- **Typeset preview while typing.** Markdown is translated to Typst and
  compiled in a Web Worker; only pages near the viewport are drawn.
- **Citations from Reader.** Sources are the collection's records implementing
  `dev.mdbase.reader.source`; each one's `csl` field is its CSL-JSON. Sources
  complete as you type (`@`, `[@`) by citekey, author, title or year, and the
  Sources panel inserts a citation, or a quotation highlighted in Reader with
  its page. Citations are formatted by citeproc-js (six bundled styles, or a
  `.csl` file in the collection; the manuscript's `lang` picks the locale) and
  match Pandoc's citeproc, including notes after punctuation, narrative
  citations in note styles and ibid/short forms.
- **Multi-record manuscripts.** Every embedded record gets its own record
  session: autosave, conflict detection when something else edits it, exact
  recovery of interrupted saves. Notes, citations and cross-references run
  across records.
- **Problems where they happen.** Unknown citekeys, missing labels, embeds or
  images, unused footnotes, malformed LaTeX and Typst errors are reported on
  the Markdown line that caused them. Clicking the preview jumps to the block
  it came from, and the preview follows the cursor. Problems with a setting
  point at the setting.
- **Export.** PDF; Word (DOCX), made in the browser by Pandoc's WebAssembly
  build, with cross-references resolved and the layout's Word styles; and a
  Pandoc/Quarto bundle (zip) to build other formats yourself.
- **Layouts.** Article and thesis templates, or a Typst file in the collection
  defining `template(title:, subtitle:, authors:, abstract:, date:, body)`.

## Layout

| Path | What |
|---|---|
| `packages/core` | Markdown dialect (lezer), per-record Typst translation with source maps, incremental citeproc with a Typst output format, manuscript assembly, Pandoc materialisation. No DOM. |
| `apps/writer` | The web app: Connect session, record-session workspace, compile worker, CodeMirror editor, canvas preview. |
| `apps/writer/typst` | The Typst runtime: helper library and the `article` and `thesis` templates. |
| `apps/writer/mdbase` | The type pack: the `dev.mdbase.writer.manuscript` contract and starter type, plus byte-identical copies of Reader's source contract and type. |

See [docs/architecture.md](docs/architecture.md) for how the pieces fit.

## Develop

```sh
pnpm install
pnpm dev                 # http://127.0.0.1:5320/?demo — a demo collection, no account needed
pnpm check               # typecheck and tests (core, manifest)
pnpm --filter @mdbase-writer/app test:browser   # end-to-end in Chromium; needs `pnpm dev` running
```

The `?demo` collection runs on the SDK's in-memory record authority
(`@mdbase-dev/connect-testing`), so record sessions, autosave, conflicts and
recovery behave as they do against a real collection. It exists only in
development builds.

### Against a real collection

The hosted mdbase connect service accepts applications served over HTTPS
only, so a `localhost` build cannot use it. Either run Connect's local
environment (`pnpm dev:environment:up` in mdbase-connect, then open the app
with `?server=<local connect URL>`), or deploy a build to an HTTPS origin and
set `MDBASE_WRITER_ORIGIN` when writing the manifest:

```sh
MDBASE_WRITER_ORIGIN=https://writer.example pnpm --filter @mdbase-writer/app build
```

`VITE_MDBASE_CONNECT_URL` and `VITE_MDBASE_CONNECT_LOOPBACK_URL` select the
Connect service and local connector (defaults: production and 28485).

## Deploy

Deployments are Cloudflare Pages branches of the `mdbase-writer` project
(targets in `apps/writer/scripts/deployment-environment.mjs`), as for mdbase
Reader:

```sh
pnpm --filter @mdbase-writer/app deploy:lab       # https://lab.mdbase-writer.pages.dev, lab Connect, connector 28487
pnpm --filter @mdbase-writer/app deploy:staging   # https://staging.mdbase-writer.pages.dev, staging Connect, connector 28486
pnpm --filter @mdbase-writer/app deploy:prod      # https://writer.mdbase.dev, production Connect, connector 28485
```

Staging and production refuse to deploy uncommitted changes
(`MDBASE_WRITER_ALLOW_DIRTY=1` overrides). Only lab serves the demo collection
at `?demo`.

The Typst compiler (28 MB) and Pandoc (58 MB) are over Pages' 25 MiB file
limit, so they live in the R2 bucket `mdbase-writer-assets` and
`functions/wasm/[name].ts` serves them on the same origin (brotli, immutable
caching; about 9.8 and 10.8 MB transferred; Pandoc only on the first Word
export). Upload new versions when typst.ts or pandoc-wasm is upgraded:

```sh
pnpm --filter @mdbase-writer/app upload:compiler
```

The Word styles are generated from Pandoc's default reference document
(`node apps/writer/scripts/reference-docx.mjs`, needs a local pandoc).

## Status

First version, deployed to lab. The end-to-end browser test passes against
the lab deployment (demo collection); it has not yet been run against a real
Connect collection. See
[docs/architecture.md](docs/architecture.md#known-limits) for known limits.
