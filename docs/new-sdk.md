# Writer's SDK backend

Writer uses the retained `vendor/sdk-eaa4e697-production-beta141.tgz` original.
The original, its bundled runtime, trust and producer provenance are unchanged.

## One connected backend

Every normal build uses `createWriterMdbase`, the SDK collection gate and
`NativeWriterBackend`. No environment means production, matching the manifest
builder's default. Explicit LAB/staging/production builds still require their
exact manifest origin; a mismatched or unknown target refuses rather than falling
back. Consent returns are delivered to the SDK before any collection owner starts.

The SDK owns account/collection selection, approval, setup, contract projection,
record sessions, write receipts, recovery and files. `NextWriterRecords` only
translates the SDK's display snapshot and Result shape for the existing workspace;
it is not a second autosave or conflict engine.

Discovery pages identities without bodies and uses SDK contract queries for
domain fields. Exact contract digests, record identities and snapshot generations
are checked. Bodies remain lazy, scoped to open records, comments and selected
source annotations. Watch changes invalidate discovery; ended watches reconnect
with bounded backoff. File downloads verify identity/revision and complete bytes.
People come from the SDK directory; failed identity access never guesses an author.

The old `ConnectBackend`, session/gates/picker, query-patched beta.125 originals,
override and Connect dev/testing dependencies are deleted. PR 16's opt-in
`NextBackend` predates this backend and is not revived.

## Demo and tests

Explicit development/LAB `?demo` URLs use the same backend on the retained SDK's
`MemoryReplica`. The fixture supplies the catalog that MemoryReplica does not
implement, a sample author and SDK-backed sample file uploads. It never contacts
an account. `?demo=large` uses that same fixture with generated records.

Browser fault injection now uses the public replica and SDK APIs, not the old
record test authority. Workspace tests use real SDK sessions, public remote-edit,
deletion and write-failure hooks. These are deterministic stand-ins, not native
runtime or live service acceptance.

## Persisted data

Manuscripts, chapters, comments and Reader metadata keep their existing formats.
Writer's local draft JSON and workspace port remain because `DraftStore` reads
previously saved browser backups; this is application data, not a legacy protocol
shim. Connected draft namespaces remain the collection ID; the demo namespace
remains `demo`. No data migration or fallback backend is introduced.

## Dependency intake

UI and i18n are exact npm `0.1.0-beta.148` pins. The direct protocol original
remains for canonical manifest validation and must match the retained SDK's
bundled protocol. Native publication checks exact originals and npm UI integrity
through `config/native-publish/production.json`; it does not rewrite producer
facts to describe a different artifact.

No deployment, publication or live connected-collection acceptance is implied by
this migration. See [development](development.md) for verification and
[native publisher](native-publisher.md) for the protected publication path.
