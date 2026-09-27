---
kind: mdbase.type
name: writer-manuscript
version: 1
description: A manuscript for mdbase writer.
schema:
  dialect: json-schema-2020-12
  value:
    $schema: https://json-schema.org/draft/2020-12/schema
    type: object
    additionalProperties: true
    required: [type, title]
    properties:
      type: { const: writer-manuscript }
      title: { type: string, minLength: 1 }
      subtitle: { type: string }
      authors:
        type: array
        items:
          oneOf:
            - type: string
              minLength: 1
            - type: object
              additionalProperties: true
              required: [name]
              properties:
                name: { type: string, minLength: 1 }
                affiliation: { type: string }
      abstract: { type: string }
      date: { type: string }
      csl: { type: string, minLength: 1 }
      template: { type: string, enum: [article, thesis] }
match:
  path_glob: manuscripts/**/*.md
  fields_present: [title]
implements:
  - contract: dev.mdbase.writer.manuscript
    version: 1.0.0-beta.1
    fields:
      title: title
      subtitle: subtitle
      authors: authors
      abstract: abstract
      date: date
      csl: csl
      template: template
---

# Writer manuscript

The starter type for mdbase writer manuscripts. The body is the manuscript's
Markdown.
