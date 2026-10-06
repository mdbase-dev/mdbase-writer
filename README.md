# mdbase writer

Write papers, theses, and books in Markdown, with a typeset preview and citations from your
mdbase Reader library. Export a PDF or Word document while keeping the manuscript as ordinary
Markdown in your mdbase collection.

**[Open writer](https://writer.mdbase.dev)** ·
[Try the demo](https://lab.mdbase-writer.pages.dev/?demo) ·
[Report a problem](https://github.com/mdbase-dev/mdbase-writer/issues)

Writer is prerelease software. Keep backups of important work and check the save status before
closing or reloading. The demo uses sample data in a separate, in-memory collection; it is not
connected to your library and is not a place to keep writing.

## See it in action

**Write, cite and typeset a paper.** Citations complete from your Reader library, the typeset
preview updates as you type, problems show on the line that caused them, and quotations come in
from Reader highlights.

https://github.com/user-attachments/assets/1d7e5564-8f69-4d2f-8194-a5fc8e789409

**Build a book from chapter records.** A thesis-layout book whose chapters are separate records:
write in one, reorder them, and add another.

https://github.com/user-attachments/assets/525c2673-cd72-46fd-9dda-ef554029d63c

These recordings use sample data, not a real collection.

## What you can do

- Write in Markdown and see the typeset result as you type.
- Find and cite sources by author, title, year, or citekey, and insert quotations from Reader highlights.
- Build a longer manuscript from separate chapter records.
- Add headings, figures, footnotes, labels, and cross-references.
- Leave comments and suggested edits alongside the text.
- Choose an article or thesis layout and a citation style.
- Export PDF, Word (DOCX), or a Pandoc/Quarto bundle for use outside Writer. Exports check
  embedded chapters and images first and tell you before downloading anything incomplete.
- Keep writing when the preview fails. Unsaved text is backed up in your browser and offered
  back after reopening, and conflicting edits can be compared side by side and merged.

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

The editor reads like the manuscript: a citation shows who it cites, a cross-reference what it
points to, footnote markers their numbers, and figures, tables, equations and code draw as
blocks. The Markdown is unchanged; the line the cursor is on always shows it as written. Turn
this off under **Editor** at the end of **Settings** to see the Markdown everywhere.

### Figures, tables and equations

Use the command palette (**Ctrl/⌘+K**) to insert a **Figure from an image**, a **Table**, an
**Equation**, a **Cross-reference** or a **Footnote**. A figure's image is stored in the
collection (in a `figures` folder beside the manuscript's other images) and written with a
label to refer to; its caption is selected to type. Pasting or dropping an image into the text
does the same.

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
editor's cursor. **Problems** in the top bar lists unknown citekeys, missing labels, unavailable
images or records, and typesetting errors under the editor, each with its record and line; the
list stays open while you fix them, and **F8** moves to the next problem.

The home screen offers the manuscript you opened last, with an optional word goal kept in this
browser, and lists any text typed but not yet saved to the collection.

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
[Open an issue](https://github.com/mdbase-dev/mdbase-writer/issues) for bugs or feature requests.
Include your browser, the steps to reproduce the problem, and any displayed error; remove
private manuscript text, collection paths, and credentials. Report suspected vulnerabilities
privately as described in the [security policy](SECURITY.md).

For local setup, tests, deployment, and implementation details, see the
[development guide](docs/development.md) and [architecture notes](docs/architecture.md).

## License

mdbase writer is available under the [MIT License](LICENSE). Bundled fonts, Typst packages, and
citation styles keep their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
