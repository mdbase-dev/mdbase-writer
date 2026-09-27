#import "common.typ": base
#import "/writer/lib.typ": bibliography-list

#let article(title: none, subtitle: none, authors: (), abstract: none, date: none, body) = {
  set document(title: title)
  set page(paper: "a4", margin: (x: 2.7cm, top: 2.8cm, bottom: 3cm), numbering: "1", fill: white)
  set heading(numbering: "1.1")
  show heading.where(level: 1): set text(size: 1.12em)
  show heading.where(level: 2): set text(size: 1em, style: "italic", weight: "regular")
  show: base
  {
    set align(center)
    set par(first-line-indent: 0em, justify: false)
    if title != none { block(below: if subtitle != none { 0.4em } else { 1em }, text(size: 1.5em, weight: "bold", title)) }
    if subtitle != none { block(below: 1em, text(size: 1.15em, subtitle)) }
    for a in authors {
      block(below: 0.3em)[#a.name]
      if a.at("affiliation", default: none) != none { text(size: 0.9em, style: "italic", a.affiliation) }
    }
    if date != none { block(above: 0.8em, text(size: 0.9em, date)) }
  }
  if abstract != none {
    pad(x: 2.4em, top: 1.2em, bottom: 1.6em, {
      set text(size: 0.92em)
      set par(first-line-indent: 0em)
      [*Abstract.* #abstract]
    })
  }
  body
}
