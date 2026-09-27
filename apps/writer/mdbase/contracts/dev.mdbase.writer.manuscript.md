---
kind: mdbase.contract
contract_type: record
id: dev.mdbase.writer.manuscript
version: 1.0.0-beta.1
name: mdbase writer manuscript
description: A document to typeset — a paper, chapter, book or thesis — whose Markdown body may embed other records.
record_schema:
  dialect: json-schema-2020-12
  value:
    $schema: https://json-schema.org/draft/2020-12/schema
    type: object
    additionalProperties: false
    required: [title]
    properties:
      title:
        type: string
        minLength: 1
      subtitle:
        type: string
      authors:
        type: array
        items:
          oneOf:
            - type: string
              minLength: 1
            - type: object
              additionalProperties: false
              required: [name]
              properties:
                name: { type: string, minLength: 1 }
                affiliation: { type: string }
      abstract:
        type: string
      date:
        type: string
      csl:
        type: string
        minLength: 1
      template:
        type: string
        enum: [article, thesis]
---

# mdbase writer manuscript

A manuscript is an ordinary Markdown record. Its body uses Pandoc citation
syntax (`[@citekey, p. 12]`), Quarto cross-references (`{#fig-x}`, `@fig-x`)
and mdbase embeds: a line holding only `![[chapters/one]]` includes that
record, so a book is a manuscript whose body embeds its chapters. Embedded
records need no particular type.

`csl` names the citation style and `template` the page layout. Citations are
resolved against records implementing `dev.mdbase.reader.source` by their
`csl.id`.
