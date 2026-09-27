// Imported by every generated file. Layout belongs in templates.
#import "/vendor/mitex/lib.typ": mi, mitex

#let missing(key) = text(fill: rgb("#b42318"), weight: "bold")[?#key]

#let missing-image(target) = block(
  width: 100%,
  inset: 1em,
  stroke: (paint: rgb("#b42318"), dash: "dashed"),
  radius: 3pt,
  align(center, text(fill: rgb("#b42318"), size: 0.9em)[Missing image: #raw(target)]),
)

// Shown in place of a raw Typst block that failed to compile, so one broken
// block cannot take the rest of the document with it.
#let broken-block(message) = block(
  width: 100%,
  inset: 0.8em,
  stroke: (paint: rgb("#b42318"), dash: "dashed"),
  radius: 3pt,
  text(fill: rgb("#b42318"), size: 0.85em)[Typst block not rendered: #message],
)

// Bibliography entries are pre-formatted by citeproc.
#let bibliography-list(title: [Bibliography], hanging: true, entries) = {
  heading(numbering: none, title)
  set par(first-line-indent: 0em, hanging-indent: if hanging { 1.6em } else { 0em }, justify: false)
  set text(size: 0.95em)
  if entries.len() > 0 and type(entries.first()) == array {
    // Numeric styles (second-field-align): label column and entry column.
    set par(hanging-indent: 0em)
    grid(columns: (auto, 1fr), column-gutter: 0.8em, row-gutter: 0.7em, ..entries.flatten())
  } else {
    for e in entries { block(below: 0.7em, par(e)) }
  }
}
