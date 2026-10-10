# New SDK migration

The current Connect and demo backends remain unchanged. This migration starts by
making `WriterRecords` and `RecordSession` explicit structural application ports
in `apps/writer/src/backend/types.ts`, instead of requiring the Connect SDK's
concrete lease/session classes in the workspace.

The port keeps the existing snapshot, draft, save, conflict, recovery and release
semantics. Current backends satisfy it without runtime adapters. In particular,
`flush` must acknowledge the current draft or return a problem while preserving
it; a new backend cannot report an optimistic pending write as saved.

The shared native record lease/session implementation is owned by the SDK views
workstream. Writer will consume that public API, not copy an app-specific SDK
session engine or an obsolete proposed route/grant protocol. Shared SDK sign-in,
manifest-driven setup, actual native files and people-directory support are also
required before the new backend can be opened.

There is no new-SDK browser mode in this structural preparation. The historical
`next/writer-sdk` draft is reference only, not the active migration branch or
launch evidence. New SDK artifacts must come from the release workstream as an
exact packed tarball with its SHA256; do not install an unqualified npm version.
