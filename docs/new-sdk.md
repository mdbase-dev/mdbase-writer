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

The release-qualified `b9965703` successor packed archive is pinned in
`vendor/mdbase-next-sdk.json`, with independently verified SHA256/SHA512. It
includes SDK837's host/caller lifetime composition fix and SDK832's optional
bounded `problemDetail`, plus the earlier public factory and provider-receipt
helpers. Release qualified all 278 archive members, 1678 SDK tests and five
browser-bundle checks (with three existing WASM-gated skips); the original
750928-byte archive is vendored unchanged. Writer consumes SDK snapshots
directly without introducing a diagnostic parser, raw-error logging or retry
authority. This pin enables no new factory or per-app native composition.
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

## Public SDK sign-in UI

`ConnectGate` accepts an optional `nativeSignIn` binding created with
`createNativeSignIn(options)`. That helper constructs the actual pinned SDK
`AppWebSignInSession`, with explicit owner-provided release/app identity/origins,
runtime, locks and original signal. The default Connect/demo backends stay intact.

The user gesture synchronously reserves a named 620×760 Connect popup before
SDK start/expiry renewal. The trusted popup keeps its production opener; the tab
fallback detaches its opener before SDK-validated navigation. No secrets,
postMessage approval or storage callback use the opener. The UI retains its
original handle after handoff and closes on completed/terminal public statuses,
never authorizing additional consent even when already paired. View teardown
closes only its owned popup. A detached fallback tab is not claimed parent-closeable
across origins. This follows TaskNotes' app-owned pattern without an SDK repin.
Approval detection, custody and lifecycle remain SDK-owned. Canonical
status/email, reopen-tab, popup-blocked and interrupted messages reflect actual
SDK state. Secondary actions reuse Writer's shared button controls instead of
browser-default button styling. A generic refusal is not labelled as a user decline. Sign out waits
for SDK close and means local shutdown, not grant revocation or store erasure;
forget delegates the actual selected collection ID to SDK `forget`.
The surrounding owner closes its borrowed SDK instance on teardown, and may
replace it only after confirmed close or explicit sign-in. Retired UI actions
cannot publish into a new binding.

The collection callback explicitly rejects with **Opening collections isn't
available in this build yet.** There is no pretend client, setup result, native
save state, offline-sync guarantee or reminder provider. Typed forwarding tests
use stand-ins; actual authenticated build inputs and qualified factory/setup
composition are still needed for a native runnable URL.
