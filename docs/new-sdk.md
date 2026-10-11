# New SDK migration

## Public application boundary

LAB builds (`VITE_MDBASE_ENV=lab`, or `pnpm build:lab` from `apps/writer`) create
one declaration-only public SDK singleton outside React and pass it to `App`.
Production builds keep the existing Connect/demo entry until the production
trust asset and cutover are approved. SDK mode lazily isolates the legacy entry
and does not create a legacy session, parse collection URLs or reserve an
app-owned popup.

`createWriterApplication` in `apps/writer/src/connect/sdk-application.ts` supplies
Writer's unchanged manifest and explicit environment to `MdbaseConnect`. The
logical manifest ID is a declaration, not a native registration receipt; the SDK
resolves the genuine native ID. An optional explicit registered ID must match
that SDK binding. SDK startup, authorization, collection selection,
configuration, foreground state and physical shutdown stay SDK-owned. The live
entry's `selection` distinguishes a requested collection from the usable native
scope. Approval, access review and choosing another collection delegate directly
to `approve`, `reauthorize` and `chooseAnother`; an unapproved URL request is never
silently replaced with another approved collection.

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
mappings. Domain metadata comes from `queryContract` projections, not an
application-side field-map projector. Complete bounded pages preserve the original
record identities and snapshot; changed digests, revisions, repeated cursors,
invalid projections and omitted records fail rather than falling back to raw
fields. Starter type names are not recognised as native implementations.
Bodies are loaded lazily using their original UUID/revision; protected or changed
records are not treated as confirmed current content. Files are read by original
file UUID/digest with current readback checks. **Image upload is unavailable in
SDK mode:** Writer's existing declaration grants files list/read, not files add.
No adapter silently widens that permission or substitutes caller MIME metadata
for native extension-based media classification.

Manuscript and comment creation/edits use public contract selectors; generic
chapters remain generic. Note adoption uses one `promote:true` contract update
with its mapped title and original revision. Comment withdrawal changes the body
and mapped fields in one update, preserving nested sibling fields. Success requires the original confirmed receipt and
current unheld, unresolved-free native readback. A lost submit reply retains its
original SDK MID; typed `error.mutationId` must match that same operation. Another
click reconciles the original operation and does not submit a new record. The SDK owns durable capture, journals and receipt recovery.
People access uses the existing SDK directory with members omitted. Failed
identity access may leave comments unsigned, never signed by a guessed account.

`NextWriterRecords` delegates leases, autosave, drafts, conflict handling and
original recovery to the existing generic `client.records.open` session. For
launch, shared workspace settings/body edits stay on that original generic session
and its atomic flush. Contract APIs handle metadata reads and discrete repository
writes. A contract-scoped lease is a post-launch improvement, not an application
session/recovery engine to implement. Writer translates display values and explicit
patches only. Scope retirement fences edits/flush completion and releases
its owned or late-delivered leases; it never closes the borrowed client or a peer's
lease. Repository disposal stops only its watches and owned scope.

## Development package and evidence

The normal original development archive from source
`2e2ae687f96d0a0c074ef6bc46bb77b97089f325`, distinct cut
`sdk-dev-2e2ae687-n1`, is pinned in `vendor/mdbase-next-sdk.json`. Its original protocol archive
is preserved byte-for-byte; the SDK producer now bundles that same protocol for
cold npm consumers. Writer retains its ordinary direct protocol file dependency.
Both SHA256 and SHA512 were checked independently, followed by ordinary and frozen
installation. There are no aliases, package rewrites, private SDK imports or
installed-module swaps. Earlier SDK/native archives remain preserved. This cut
includes atomic contract body updates/promotion and public explicit-digest
`MemoryContract` fixtures; no application loader workaround is supplied.

Root tests now use `createApplicationFixture` from `@mdbase-dev/sdk/testing` and
its public structural entry, not hidden hooks on a production constructor.
Catalog/type and lifecycle/readiness metadata stand-ins are explicit; record,
lease, file, receipt and readback tests run through the real public SDK over
`MemoryReplica`.

This is **development intake, not release qualification**. The distinct `n1`
packet carries the original 3,462,973-byte native runtime matching the committed
`6762b92e…` pin, including the resources export and promotion support. Its
`native.available=true` describes packaged integrity, not native launch,
registration, custody or live authentication acceptance. The earlier source-only
`2e2ae687` cut remains a separate immutable packet; it was not overwritten.
Passing `MemoryReplica` tests does not establish runtime acceptance. Production
remains legacy; this port has not been deployed or merged into Writer main.

## Historical low-level sign-in UI

`createNativeSignIn`/`NativeSignIn` remain optional legacy adapter preparation.
They are not the public-entry SDK-mode bootstrap or a template for new app popup,
storage or runtime code. New SDK mode delegates authorization to the public
application in the original user gesture. Original artifacts and earlier evidence
are retained; the unsafe SDK807 archive must not be reused.
