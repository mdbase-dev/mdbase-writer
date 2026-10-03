---
kind: mdbase.type
name: reader-source
version: 1
description: A source and user-authored literature note for mdbase Reader.
schema:
  dialect: json-schema-2020-12
  value:
    $schema: https://json-schema.org/draft/2020-12/schema
    type: object
    additionalProperties: true
    required: [type, id, title, kind, saved_at]
    properties:
      type: { const: reader-source }
      id: { type: string, minLength: 1 }
      title: { type: string, minLength: 1 }
      kind: { type: string, minLength: 1 }
      authors:
        type: array
        items: { type: string }
      published:
        oneOf:
          - type: string
          - type: number
      url: { type: string }
      description: { type: string }
      language: { type: string }
      saved_at: { type: string, format: date-time }
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
      csl: { type: object }
match:
  path_glob: sources/**/*.md
  fields_present: [id, title, kind]
collection:
  unique:
    - field: id
      scope: type
  links:
    documents[].file:
      target_type: any
      validate_exists: true
    relations[].target:
      target_type: reader-source
      validate_exists: false
implements:
  - contract: dev.mdbase.reader.source
    version: 1.0.0-beta.1
    fields:
      id: id
      title: title
      kind: kind
      authors: authors
      published: published
      url: url
      description: description
      language: language
      saved_at: saved_at
      documents: documents
      reading: reading
      tags: tags
      relations: relations
      csl: csl
---

# Reader source

The source body is the user's literature note. Reader never regenerates it
from annotations.
