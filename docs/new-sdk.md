# New SDK migration

## Public application boundary

`App` accepts an optional public `MdbaseApplicationEntry`. Without it, Writer
continues to use its existing Connect/demo entry. SDK mode lazily isolates that
legacy entry and does not create a legacy session, parse collection URLs or
reserve an app-owned popup.

`createWriterApplication` in `apps/writer/src/connect/sdk-application.ts` takes
an explicit registered application ID and environment, and supplies Writer's
unchanged declaration to `MdbaseConnect`. A logical manifest ID is not a native
registration receipt. SDK startup, authorization, collection selection,
configuration, foreground state and physical shutdown stay SDK-owned.

`SdkWriterRoot` requires the selected original connection, matching native client
collection, current connection and current successful aggregate readiness before
opening the domain UI. Configuration success alone does not open Writer. Sign-out
waits for SDK close; failed close retains the current view. Retired caller actions
cannot sign out or navigate a replacement. Canonical SDK email or GitHub login is
shown without inventing an email address or using an account UUID as a label.

## Native domain repository

`NativeWriterBackend` implements the existing `WriterBackend` interface directly
through the public connection's actual records, files and people clients. Both
backends use the same `Manuscripts`, `Home` and `WorkspaceView` UI. The existing
manuscript-only route and unsaved-navigation guard are shared; the SDK still owns
collection URL handling. Theme, feedback, recent manuscripts, drafts, compilation
and export continue through the existing application components.

Discovery checks Writer's exact declared native contracts and actual type field
mappings. It uses complete bounded metadata pages, rejects changed/repeated
snapshots and does not recognise starter type names as native implementations.
Bodies are loaded lazily using their original UUID/revision; protected or changed
records are not treated as confirmed current content. Files are read by original
file UUID/digest with current readback checks. **Image upload is unavailable in
SDK mode:** Writer's existing declaration grants files list/read, not files add.
No adapter silently widens that permission or substitutes caller MIME metadata
for native extension-based media classification.

Manuscript/chapter creation, note adoption and comment edits use the public SDK's
native writes and CAS. Success requires the original confirmed receipt and
current unheld, unresolved-free native readback. A lost submit reply retains its
original SDK MID; another click reconciles that original operation and does not
submit a new record. The SDK owns durable capture, journals and receipt recovery.
People access uses the existing SDK directory with members omitted. Failed
identity access may leave comments unsigned, never signed by a guessed account.

`NextWriterRecords` delegates leases, autosave, drafts, conflict handling and
original recovery to `client.records.open`. Writer translates display values and
explicit patches only. Scope retirement fences edits/flush completion and releases
its owned or late-delivered leases; it never closes the borrowed client or a peer's
lease. Repository disposal stops only its watches and owned scope.

## Development package and evidence

The normal original development archive from source
`8a557ad68290e04146e456df94c4946d6f033ea7` is pinned in
`vendor/mdbase-next-sdk.json`. Its required original browser-safe protocol archive
is in the workspace consumer's `apps/writer/vendor/`, with an ordinary direct
file dependency. Both SHA256 and SHA512 values were checked independently. There
are no aliases, package rewrites, private SDK imports or installed-module swaps.
The historical SDK837 archive remains preserved.

Root tests now use `createApplicationFixture` from `@mdbase-dev/sdk/testing` and
its public structural entry, not hidden hooks on a production constructor.
Catalog/type and lifecycle/readiness metadata stand-ins are explicit; record,
lease, file, receipt and readback tests run through the real public SDK over
`MemoryReplica`.

This is **development intake, not release qualification**. This packet includes
its original native runtime (3,427,675 bytes), including `rt_app_resources`;
`native.available` is now true for packaged integrity inputs. Runtime bytes and
passing source tests do not establish the completed application singleton,
native launch, registration, custody or live authentication acceptance.
Production defaults, LAB pins and deployment remain unchanged pending the
separately authorized qualification and cutover.

## Historical low-level sign-in UI

`createNativeSignIn`/`NativeSignIn` remain optional legacy adapter preparation.
They are not the public-entry SDK-mode bootstrap or a template for new app popup,
storage or runtime code. New SDK mode delegates authorization to the public
application in the original user gesture. Original artifacts and earlier evidence
are retained; the unsafe SDK807 archive must not be reused.
