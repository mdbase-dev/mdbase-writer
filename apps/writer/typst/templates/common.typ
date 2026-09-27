// Shared typographic defaults for the bundled templates.
#let base(body) = {
  set text(font: "Libertinus Serif", size: 11pt, lang: "en", hyphenate: true)
  set par(justify: true, leading: 0.62em, spacing: 0.62em, first-line-indent: 1.2em)
  show heading: set block(above: 1.5em, below: 0.9em)
  set footnote.entry(gap: 0.45em, clearance: 1.2em)
  show footnote.entry: set text(size: 0.88em)
  show footnote.entry: set par(first-line-indent: 0em, leading: 0.55em)
  show quote.where(block: true): it => pad(x: 1.6em, block(above: 1em, below: 1em, {
    set par(first-line-indent: 0em)
    set text(size: 0.95em)
    it.body
  }))
  show figure.caption: set text(size: 0.9em)
  show figure: set block(above: 1.4em, below: 1.4em)
  show raw: set text(font: "DejaVu Sans Mono", size: 0.86em)
  set table(inset: (x: 0.6em, y: 0.45em))
  show table.cell.where(y: 0): set text(weight: "bold")
  show link: it => it
  body
}
