# Architecture

## Data

- **Manuscripts** implement `dev.mdbase.writer.manuscript` (title, subtitle,
  authors, abstract, date, `csl` style, `template`, `lang`). The body is
  Markdown. `csl` and `template` name a bundled style or layout, or a `.csl`
  or `.typ` file in the collection, loaded like images.
  A record is a manuscript because it declares the type
  (`type: writer-manuscript`, or in a list with its other types), not because
  of where it lives: the starter type has no path rule, only
  `match.where.type.contains: writer-manuscript` for collections that turn
  explicit type keys off. New manuscripts are created by the collection's
  implementing type (found through `describe()`), using that type's field
  names and the collection's explicit type key; "Use as manuscript" adds the
  type to an existing note. How manuscripts are recognised is configured in
  the collection's type file, not in the app.
- **Chapters** are any Markdown records, embedded by a line holding only
  `![[path]]`. They need no type.
- **Sources** are records implementing `dev.mdbase.reader.source`; the citekey
  is `csl.id`. The writer's type pack carries byte-identical copies of Reader's
  contract and starter type, so setting up a collection for the writer also
  makes it Reader-compatible, and doing so where Reader already runs is a
  no-op. `apps/writer/scripts/manifest.test.mjs` checks the copies still match
  Reader's.
- **Annotations** are Reader's `dev.mdbase.reader.annotation` records (queried
  through the contract where the collection has it, else by Reader's type
  name). The first blockquote of the body is the quotation; `locator.label`
  ("p. 12") becomes the citation's locator.
- **Comments** are records implementing `mdbase.comment` (from mdbase
  contracts, whose published pack the writer's manifest embeds unchanged).
  A thread's first comment carries its anchor, a quote of the record's body
  (`core/comments.ts` finds it again after edits, or reports it detached);
  replies link to it. A suggested edit is a comment with a replacement; the
  editor shows it as a tracked change, and accepting it edits the record
  through its session. Authors are links to the signed-in account's
  `mdbase.person` record, found through Connect's optional identity
  permission; without it, comments are unsigned.
- **Images** are collection files, referenced relative to the record
  (`![Caption](figures/plot.png){#fig-plot}`) or by wikilink (`![[plot.png]]`).

The manifest declares capability groups `collection.read`, `records.create`
and `records.edit` (v2) and file `list`/`read`. The writer never deletes or
renames records.

## Pipeline

```text
record sessions (main thread)            compile worker
─────────────────────────────            ─────────────────────────────────────────
connection.records.open(path)  ──body──▶ translateRecord (per record, cached by body)
  one per manuscript record               └─ placeholders for citations, images, embeds
  and per embedded record                ManuscriptAssembler (whole manuscript)
                                           ├─ include order, cycle and missing checks
          ◀── unloaded records ──────────  ├─ @key → cross-reference or citation
          ◀── needed images ─────────────  ├─ citeproc (incremental) → Typst markup
                                           ├─ images → collection files or placeholders
                                           └─ source maps shifted through substitution
                                         Typst (WASM): compile → vector + block positions
canvas preview  ◀──── artifact ────────  raw-block isolation: a broken ```{=typst}``` block
  (pages near viewport only)               is replaced by an error box and recompiled
```

- **Translation** (`core/translate.ts`) walks the lezer tree of one body.
  Everything that depends on other records is a placeholder. Every emitted run
  records an anchor (Typst offset → body offset), and each top-level block gets
  an invisible `#metadata((md-file, offset))<md-src>` marker (inside headings,
  so it lands on the heading's page even when a template breaks the page).
- **Assembly** (`core/assemble.ts`) resolves placeholders across the
  manuscript and runs citeproc once over all clusters in document order, so
  note numbers, ibid and disambiguation are right across chapters. It follows
  Pandoc's rules: notes after punctuation, narrative citations as author plus
  author-suppressed note, full inline citations inside footnotes, capitalised
  notes.
- **Citeproc** (`core/citeproc.ts`) emits Typst through a custom citeproc-js
  output format. When one cluster is inserted or changed it uses
  `processCitationCluster` instead of re-running the document; a property test
  checks this equals a full rebuild after every edit. Unchanged sequences are
  cached, so typing never touches citeproc.
- **The worker** (`app/compile/worker.ts`) coalesces edits (it yields to the
  message queue before each compile), pushes only changed Typst files, maps
  Typst diagnostics back to records, and queries block positions for
  click-to-source.
- **The preview** (`app/preview/Preview.tsx`) keeps one typst.ts render
  session, sizes a placeholder per page, and draws only pages near the
  viewport (IntersectionObserver), so update cost follows what is on screen.
- **The editor** (`app/editor`) uses the same lezer extensions as the
  translator. It never adopts an echo of its own earlier text from the session
  (that would undo keystrokes typed since). The cursor's block is scrolled into
  view in the preview when it is off screen.
- **Settings problems.** A diagnostic about the frontmatter carries its
  `field`; Typst errors in the generated main file are mapped to the setting
  written on that line, and errors in a template to `template`.

## Word export

`materialize` (core) inlines embeds and, in `resolved` mode, numbers
cross-references as the templates do (`crossref.ts`: sections 1.1, figures,
tables and equations each counted) and writes the numbers into headings,
captions, equations and references, since Pandoc's DOCX writer numbers none
of them. Pandoc's official WebAssembly build (`pandoc-wasm`) runs in its own
worker, started on the first export; it formats citations with its own
citeproc from the same CSL and CSL-JSON, and takes Word styles from
`public/docx/<template>.docx`. The Pandoc bundle uses `quarto` mode instead
and leaves cross-references to Quarto.

## Measured

Chromium, demo collection, keystroke to painted preview (p50): 4-page paper
83 ms; 30-page paper 116 ms (before virtualised drawing: 1.3 s); 6-page thesis
of three records 77 ms. Compiling a 141-page thesis takes about 350 ms per
keystroke (from the spike). Download: about 9.4 MB compressed, mostly the
Typst compiler, cached after the first visit. The Word export adds about
16 MB (Pandoc) on its first use; the demo paper converts in about a second.

## Known limits

- Not yet run against a real Connect collection (see the README).
- Deleting a citation, or adding a footnote before existing citations, still
  rebuilds citeproc (about 1 s at 1,000 clusters); inserting or changing a
  citation is incremental.
- Word output takes its structure from Pandoc, not from the Typst template: a
  collection template affects the PDF only (the Word export uses the article
  styles). Cross-reference words ("Figure", "Abschnitt") cover the bundled
  locales' languages.
- Two templates (article, thesis), six citation styles and eight CSL locales
  are bundled; others come from the collection (styles, templates) or fall
  back to en-US (locales).
- A collection template is one file: files it imports are not loaded.
- typst.ts 0.7.0 quirks worked around here: `renderToSvg` caches by container
  width and needs `window.typstProcessSvg`; `world.compile`/`world.vector`
  return nothing for `diagnostics: "none"`.
- Reader data the writer depends on has shapes Pandoc rejects (array
  `keyword`, empty `literal` names) and ISO 639-2 `language` codes (`eng`) that
  change title-casing; the Word export cleans the first two.
