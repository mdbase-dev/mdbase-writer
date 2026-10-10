# New SDK migration

The current Connect and demo backends remain unchanged. This migration starts by
making `WriterRecords` and `RecordSession` explicit structural application ports
in `apps/writer/src/backend/types.ts`, instead of requiring the Connect SDK's
concrete lease/session classes in the workspace.

The port keeps the existing snapshot, draft, save, conflict, recovery and release
semantics. Current backends satisfy it without runtime adapters. In particular,
`flush` must acknowledge the current draft or return a problem while preserving
it; a new backend cannot report an optimistic pending write as saved.

`NextWriterRecords` in `apps/writer/src/backend/next-records.ts` now delegates
record opens and session methods to the public SDK `client.records.open` API.
The SDK owns autosave, shared peer leases, capture, CAS, receipts and recovery;
Writer only translates native Map/record snapshots into its display JSON and
Result port. Explicit JSON patches are validated and copied without rewriting
untouched native values. The genuine native snapshot remains available for
persisting original recovery MID/record/receipt/write evidence; recovery refs
are passed unchanged to SDK open. Owner cancellation fences open/flush delivery
and releases a late lease without closing the borrowed client. There is no
app-specific session engine or proposed route/grant protocol. Shared SDK sign-in,
manifest-driven setup, actual native files and people-directory support are also
required before the new backend can be opened.

The release-qualified `8cbc82fb` successor packed archive is pinned in
`vendor/mdbase-next-sdk.json`, with independently verified SHA256/SHA512. It
includes SDK808's session fix, SDK809 leases and SDK814's shared read helpers.
The working records/session delegate is unchanged; ordinary readMany gets do
not prove a native atomic snapshot or qualify People producer compatibility.
This is source/package
qualification, not per-app trust/origin/runtime/custody/operation acceptance.
The earlier unsafe SDK807 `5ba1314b` archive must not be reused. Tests exercise
the shared MemoryReplica stand-in and typed forwarding ports, not native/LAB
parser, sign-in, durability or browser acceptance.

There is no new-SDK browser mode in this adapter preparation. The historical
`next/writer-sdk` draft is reference only, not the active migration branch or
launch evidence. New SDK artifacts must come from the release workstream as an
exact packed tarball with its SHA256; do not install an unqualified npm version.
