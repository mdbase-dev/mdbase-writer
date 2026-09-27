---
kind: mdbase.contract
contract_type: record
id: dev.mdbase.reader.source
version: 1.0.0-beta.1
name: mdbase Reader source
description: A saved source, its readable representations, and its literature note.
record_schema:
  dialect: json-schema-2020-12
  value:
    $schema: https://json-schema.org/draft/2020-12/schema
    type: object
    additionalProperties: false
    required: [id, title, kind, saved_at]
    properties:
      id:
        type: string
        minLength: 1
      title:
        type: string
        minLength: 1
      kind:
        type: string
        minLength: 1
      authors:
        type: array
        items: { type: string }
      published:
        oneOf:
          - type: string
          - type: number
      url:
        type: string
      description:
        type: string
      language:
        type: string
      saved_at:
        type: string
        format: date-time
      documents:
        type: array
        items:
          type: object
          additionalProperties: true
          required: [file]
          properties:
            file_id: { type: string }
            file: { type: string, minLength: 1 }
            role: { type: string }
            revision: { type: string, pattern: "^sha256:[0-9a-f]{64}$" }
            format: { type: string }
            media_type: { type: string }
            label: { type: string }
      reading:
        type: object
        additionalProperties: true
        properties:
          status: { type: string }
          progress: { type: number, minimum: 0, maximum: 1 }
      tags:
        type: array
        items:
          type: [string, number, boolean]
      relations:
        type: array
        items:
          type: object
          additionalProperties: true
          required: [relation, target]
          properties:
            relation: { type: string }
            target: { type: string }
      csl:
        type: object
---

# mdbase Reader source

The portable Reader view of a saved source. The Markdown body remains the
user-authored literature note and is deliberately outside the frontmatter
projection.
