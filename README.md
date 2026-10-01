# mdbase writer

Write papers, theses, and books in Markdown, with a typeset preview and citations from your
mdbase Reader library. Export a PDF or Word document while keeping the manuscript as ordinary
Markdown in your mdbase collection.

**[Open writer](https://writer.mdbase.dev)** ·
[Try the demo](https://lab.mdbase-writer.pages.dev/?demo) ·
[Open mdbase Reader](https://reader.mdbase.dev)

Writer is prerelease software. Keep backups of important work and check the save status before
closing or reloading. The demo uses sample data in a separate, in-memory collection; it is not
connected to your library and is not a place to keep writing.

## What you can do

- Write in Markdown and see the typeset result as you type.
- Find and cite sources by author, title, year, or citekey, and insert quotations from Reader highlights.
- Build a longer manuscript from separate chapter records.
- Add headings, figures, footnotes, labels, and cross-references.
- Leave comments and suggested edits alongside the text.
- Choose an article or thesis layout and a citation style.
- Export PDF, Word (DOCX), or a Pandoc/Quarto bundle for use outside Writer.

## Get started

1. Open [writer](https://writer.mdbase.dev) and choose **Connect a collection**.
2. Sign in through mdbase Connect, choose a collection, and review the access Writer requests.
   Choose the collection containing your Reader library if you want to cite its sources.
3. If prompted, review the proposed setup and choose **Set up collection**. Writer adds the
   manuscript and source types it needs; setup is not applied without your approval.
4. Choose **New manuscript**, enter a title, and select a layout and citation style.
5. Start writing in the editor. The preview updates alongside your text. Use **Settings** to
   change the title, authors, abstract, date, language, layout, or citation style.

You can also choose **Use a note you already have…** when creating a manuscript. **Use as
manuscript** adds the manuscript type to that note while retaining its other types, text, and location.

Collections can be hosted through Connect or registered from your computer. For a
computer-backed collection, keep the Connect desktop app running and the computer available.

## Write and cite

Writer uses familiar Markdown plus Pandoc citation and Quarto cross-reference syntax. You do
not need to write Typst or LaTeX to use the bundled layouts.

```markdown
# Introduction {#sec-introduction}

A claim supported by a source [@smith2024, p. 12].

See @sec-introduction and @fig-results.

![Results](figures/results.png){#fig-results}

A sentence with a footnote.[^note]

[^note]: A longer explanation.
```

Replace `smith2024` with a citekey from your library and the image path with a file in your collection.

### Sources and citations

Open **Sources** to search your Reader library and insert a citation, optionally with a page
number. Sources already cited in the manuscript appear first. You can also type `@` or `[@`
to see completion suggestions by citekey, author, title, or year.

Each source needs citation metadata and a citekey. Manage those in [mdbase Reader](https://reader.mdbase.dev)
in the same collection. Reader highlights can be inserted as quotations with their source citation
and page information when available.

Hover over a citation to see its bibliography entry. Choose the manuscript's citation style in
**Settings**; bundled styles are available, or you can choose a `.csl` file stored in the collection.

### Chapters and longer manuscripts

To include another Markdown record, put its embed on a line of its own:

```markdown
![[chapters/introduction]]

![[chapters/results]]
```

Writer assembles these records in order. Citations, footnotes, and cross-references work across
the manuscript. Chapter records do not need a special manuscript type.

Use **Outline** to open or add chapters. Drag chapters, or use **Alt+↑/↓**, to reorder them.
Chapter cards in the editor show their title, word count, and problems, with a button to open them.

## Navigate and review

Click a block in the preview to jump to the corresponding text. The preview also follows the
editor's cursor. Use **Problems** to find unknown citekeys, missing labels, unavailable images
or records, and typesetting errors. **F8** moves to the next problem.

The sidebar, editor/preview split, and zoom are remembered in your browser. On a phone, switch
between writing, preview, and outline views.

Useful shortcuts (**⌘** on macOS, **Ctrl** elsewhere):

| Shortcut       | Action                   |
| -------------- | ------------------------ |
| Ctrl/⌘+K       | Open the command palette |
| Ctrl/⌘+Shift+E | Find a source            |
| Ctrl/⌘+,       | Open manuscript settings |
| Ctrl/⌘+Shift+S | Choose an export format  |
| F8             | Go to the next problem   |

## Export your work

Use the menu beside **Export** to choose a format. The main button repeats the format you
used last in this browser.

- **PDF:** the typeset document, using the selected layout.
- **Word (DOCX):** an editable document with formatted citations and resolved cross-references.
  Word uses its own document styles, not the exact PDF layout. A custom Typst layout affects
  PDF only; Word uses article styles for those layouts.
- **Pandoc bundle (ZIP):** a materialised Markdown manuscript, references, citation style, and
  supporting files for building with Pandoc or Quarto outside Writer.

Exports are generated in your browser. The first Word export downloads about 16 MB of additional
software, so it may take longer. Review export warnings and check the downloaded document before
sharing or submitting it; missing inputs can result in incomplete output.

## Your writing and saving

Manuscripts and chapters remain Markdown records in your collection. Settings are stored in
the manuscript's frontmatter, and citations refer to your Reader sources. Writer does not delete
or rename records.

Edits autosave through Connect. If a record changes elsewhere while you are editing, Writer
shows a conflict: **Keep mine** retains your version, while **Use theirs** adopts the other version.
Check both versions before choosing. If a save fails, the editor keeps the current text and retries
saving when you type; do not assume it has reached the collection until the save status confirms it.

## Help and development

If a collection will not open, check its Connect access and, for a computer-backed collection,
that its desktop app is online. Use **Reconnect** or choose another collection when prompted.
When reporting a problem, include your browser, the steps to reproduce it, and any displayed
error; remove private manuscript text, collection paths, and credentials.

For local setup, tests, deployment, and implementation details, see the
[development guide](docs/development.md) and [architecture notes](docs/architecture.md).
