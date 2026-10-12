# New SDK migration

## Public application boundary

LAB builds (`VITE_MDBASE_ENV=lab`, or `pnpm build:lab` from `apps/writer`) create
one declaration-only public SDK singleton outside React and pass it to `App`.
Production builds keep the existing Connect/demo entry until the production
trust asset and cutover are approved. SDK mode lazily isolates the legacy entry
and does not create a legacy session, parse collection URLs or reserve an
app-owned popup.

`createWriterMdbase` in `apps/writer/src/connect/sdk-application.ts` supplies
Writer's unchanged manifest and explicit environment to the SDK's `createMdbase`
front door, with `readiness: {typeIssues: "degrade"}`. The logical manifest ID is
a declaration, not a native registration receipt; the SDK resolves the genuine
native ID. An optional explicit registered ID must match that SDK binding. SDK
startup, authorization, collection selection, configuration, foreground state and
physical shutdown stay SDK-owned.

The collection screens come from `@mdbase-dev/ui/collections`, vendored as
`vendor/mdbase-dev-ui-dev-25f3b96a.tgz` (pin: `vendor/mdbase-ui-dev.json`). Its
optional `@mdbase-dev/sdk` peer resolves to Writer's own SDK dependency.
`SdkWriterRoot` calls `start()` and renders the shared `CollectionGate`, which
owns sign-in, choosing, approval, setup review, problems and sign-out (always
`signOut()`, never `close()`). Writer opens its domain UI only for the
connection the gate hands over in phase `ready`, keyed by collection ID and
generation; leaving that phase retires the scope's leases. The shared
`CollectionSwitcher` sits in the top bar on the manuscript list and is hidden
inside a manuscript, where leaving goes through the manuscript's own save guard.
The `--mdbase-collections-*` properties map onto Writer's tokens in
`apps/writer/src/ui/writer-collections.css`.

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
record identities and snapshot; changed digests, revisions, repeated cursors and
omitted records fail rather than falling back to raw fields. A record whose
projection has an error stays listed without projected fields; it never blocks
the collection. Unrelated definition diagnostics do not block usable Writer
records, and an error on one of Writer's own type definitions makes only that type
unavailable, with plain copy on Home. Exact required contracts still must pass.
Untyped Markdown notes remain in the complete index and are listed on Home with a
"No type" label.
Starter type names are not recognised as native implementations.
Bodies are loaded lazily using their original UUID/revision; protected or changed
records are not treated as confirmed current content. Files are read by original
file UUID/digest with current readback checks. **Image upload is unavailable in
SDK mode:** Writer requires files list/read and declares files add optional. Its
native backend does not enable uploads; the upload command and image paste/drop
handler are hidden until incremental consent is integrated and validated.
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
lease. Repository disposal stops only its watches, its reconnect timer and owned
scope. When Writer's own change watch goes stale, fails or closes, Writer recreates it
through the public SDK. A discovery read does this at once; otherwise one background
reconnect waits 0.5 s, doubling to 30 s, and the wait resets once a watch is
active. Retired callbacks are fenced and there is never more than one watch or timer.
A reconnected watch reloads the collection, and it never closes the borrowed client.

## Development package and evidence

The normal original development archive from source
`fb3308a885bdb7e06152f372b39f545e9e7ecfd2`, original cut
`sdk-dev-fb3308a8`, is pinned in `vendor/mdbase-next-sdk.json` (4117568 bytes,
SHA256 `0b199a75074f30175b6813d8ec9a72c47b36149d28122c442270d7ae30581944`).
The SDK bundles the original beta129 `c280cd194ffd` protocol archive; Writer's
ordinary direct `d765e675c3da` legacy protocol dependency is unchanged. This
archive has no vendor warnings; the earlier unused-protocol exception is not
carried forward.
Both SHA256 and SHA512 were checked independently, followed by ordinary and frozen
installation. There are no aliases, package rewrites, private SDK imports or
installed-module swaps. Earlier SDK/native archives remain preserved. This cut
includes atomic contract body updates/promotion and public explicit-digest
`MemoryContract` fixtures, public error/status helpers and portable/native-origin
sign-in APIs in one pin; no application loader workaround is supplied. The `41c`
cut adds SDK-owned per-type readiness degradation, safe user-facing error copy
and action labels, log-service CORS support and a thin-client entry. Writer opts
into `{readiness: {typeIssues: "degrade"}}`; unavailable Writer types stay
unavailable while usable types remain accessible. Packaged CORS code does not
prove a deployed extension origin or authenticated acceptance.

Root tests now use `createApplicationFixture` from `@mdbase-dev/sdk/testing` and
its public structural entry, not hidden hooks on a production constructor.
Catalog/type and lifecycle/readiness metadata stand-ins are explicit; record,
lease, file, receipt and readback tests run through the real public SDK over
`MemoryReplica`.

The current cut adds SDK-owned lazy Worker startup, pairing only from a sign-in
gesture, native-return opening and refused/expired sign-in recovery. Sign in stays
enabled while authorizing and invokes SDK `approve()`; SDK refusal copy is unchanged.
Image insertion declares `files:add` optional, but native uploads remain disabled
until public incremental consent is integrated and validated. No startup add permission
or app-side consent/renewal engine is introduced.

This is **DEV/LAB development intake, not release qualification**. The original `4c`
packet carries the 3,555,291-byte native runtime matching the committed
`9f90af73e1591cafe9c35bdd42f18ae49d5a91a0186e78695e841fecabcd833a` pin,
including the public setup-assessment ABI and owner-binding fixes,
including the resources export and promotion support, registration-refusal
guidance, Private-collection availability reasons and collection deletion APIs. Its
`native.available=true` describes packaged integrity, not native launch,
registration, custody or live authentication acceptance. The earlier source-only
`2e2ae687` cut remains a separate immutable packet; it was not overwritten.
Passing `MemoryReplica` tests does not establish runtime acceptance. Production
remains legacy; this port has not been deployed or merged into Writer main.

## Readiness and setup review

`next/new-sdk` combines the public-entry line with settled readiness actions and
SDK setup review. Missing or failed readiness offers **Check again** through
`assess()`; a retired connection offers the SDK chooser. SDK `describeError`
provides safe headings, copy and recovery actions, including validated update
links for incompatible versions. Active checks remain loading. No native
workspace is allocated before aggregate readiness and the original connection
are current.

Setup reads the SDK plan before showing its summary, changes, conflicts and
refusal. Confirm applies that original object; an empty plan uses `configure()`.
Unknown outcomes re-assess through the SDK rather than claim no changes or
submit a fresh mutation automatically. Scope retirement fences the review.

Live migration, update and suspension status uses `summarizeStatus` over the
original client without replacing a still-current editable workspace, its local
edits or record leases. Teardown removes only owned listeners/adapters, never the
borrowed client.

## Historical low-level sign-in UI

`createNativeSignIn`/`NativeSignIn` remain optional legacy adapter preparation.
They are not the public-entry SDK-mode bootstrap or a template for new app popup,
storage or runtime code. New SDK mode delegates authorization to the public
application in the original user gesture. Original artifacts and earlier evidence
are retained; the unsafe SDK807 archive must not be reused.
