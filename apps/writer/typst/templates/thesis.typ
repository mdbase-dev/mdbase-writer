#import "common.typ": base
#import "/writer/lib.typ": bibliography-list

// A book-length layout: a title page, roman-numbered front matter (abstract,
// contents), then arabic-numbered chapters that each open on a new page.
// Level-1 headings are chapters.
#let thesis(title: none, subtitle: none, authors: (), abstract: none, date: none, body) = {
  set document(title: title)
  set page(paper: "a4", margin: (inside: 3cm, outside: 2.5cm, top: 2.8cm, bottom: 3cm), fill: white)
  show: base

  // Title page
  page(numbering: none, align(center + horizon, {
    set par(first-line-indent: 0em, justify: false)
    if title != none { block(below: 1em, text(size: 2em, weight: "bold", title)) }
    if subtitle != none { block(below: 2em, text(size: 1.3em, subtitle)) }
    for a in authors {
      block(below: 0.3em, text(size: 1.15em, a.name))
      if a.at("affiliation", default: none) != none { text(style: "italic", a.affiliation) }
    }
    if date != none { block(above: 2em, date) }
  }))

  // Front matter
  set page(numbering: "i")
  counter(page).update(1)
  if abstract != none {
    heading(level: 1, numbering: none, outlined: false)[Abstract]
    abstract
    pagebreak(weak: true)
  }
  outline(title: [Contents], depth: 2, indent: auto)
  pagebreak(weak: true)

  // Main matter
  set page(numbering: "1")
  counter(page).update(1)
  set heading(numbering: "1.1")
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    set par(first-line-indent: 0em, justify: false)
    v(3em)
    if it.numbering != none {
      block(below: 0.6em, text(size: 1em, weight: "regular", fill: luma(35%))[Chapter #counter(heading).display("1")])
    }
    block(below: 2em, text(size: 1.7em, weight: "bold", it.body))
  }
  show heading.where(level: 2): set text(size: 1.1em)
  set math.equation(numbering: none)
  body
}
