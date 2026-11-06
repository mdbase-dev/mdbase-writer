# Writer round 7

Branch: `polish-r7`, based on `c2f19fdfffd80d0e4d70faade1ea687ea4c4157e`.
Scope is the round-seven Writer plan. PR #20 and lower-panel behavior are not
changed. No deployment or merge is part of this change.

## Delivery ledger

| Plan item | Result | Before → after; proof boundary |
| --- | --- | --- |
| W1.1 SDK intake | Implemented; live recovery unproven | LAB/staging `eaa4e697`, production beta.156 → all three beta.157. Original archives verified, not repacked. Quota recovery has not been exercised with the candidate on LAB. |
| W1.2 Reload/write | Repeatable check added; not run against candidate | Council LAB write loss 2/2 → no new live survival rate claimed. `test:lab:reload-write` requires an owned `[test]` manuscript, reloads before writing, waits for the real session acknowledgement, and reads from a new context with no Writer origin storage. It restores the original body in cleanup. |
| W1.3 Sync truth | Implemented and unit-tested | A local-only save could remain a waiting notice indefinitely → rejected ledger entries immediately, or pending age ≥30,000 ms, say “Changes haven't reached the server”. The existing save slot offers Download local drafts and a polite live region. A timer advances the notice without requiring another SDK snapshot; confirmation clears it. No SDK write, retry or acknowledgement is altered. “Stay online” was absent from Writer's source before this change. |
| W1.4 Revoked access after reload | Not fixed or live-proven | No before/after revoked-access result is claimed. This remains a shared SDK/problem-descriptor follow-up, not a Writer auth workaround. |
| W1.5 Cancel / collection hint / Install | Install fixed; other handoffs not fixed | Current deployed LAB Cancel reproduced “Can't continue / Sign-in didn't go through”; Install was also present on that gate. The app now permits installation only under Home/workspace, with removal on gate transitions (unit test). No claim that beta.157 fixes cancellation or preselection. The reload check records preselection and only approves the explicitly named test collection. |
| W2.1 Sidebar work | Partial; long-task acceptance incomplete | Original dev sample: 63–93 ms long tasks and 45–90 ms setup-to-fade; council 55–107 ms. Final optimized run: zero ≥50 ms tasks over four toggles, first fade 16.9–31.3 ms from the actual key event; first bitmap mutations 209.7–253.4 ms, after the unchanged 160 ms animation. Other optimized runs still recorded 52/54 ms tasks. Last full 10k-word dev matrix passes 2/8 cases: two desktop reduced-motion cases fail at 51/54/66 ms; all four phone cases time out waiting for a rendered revision while Preview is hidden. That full matrix predates the explicit phone-reveal scheduling fix and was not rerun afterward. The one-frame fade goal is not fully proven. Removed the explicit forced layout, closed-sheet rendering and unstable preview retry callback; coalesced drawing behind the existing animation. These build/readiness conditions are not a controlled percentage improvement. |
| W2.2 Hidden prose | Implemented and browser-tested | Switching to preview-only previously started WAAPI and CSS fades on the hidden editor → zero animations on hidden Write and Preview containers in the optimized gate. Deleted the desktop/mobile prose hide fade rather than adding another animation. A new artifact while Preview is hidden produces zero canvas mutations. Verified that plain `checkVisibility()` returned true on CSS-hidden Preview; the guard now checks the visibility property explicitly. Preview remains undimmed. |
| W2.3 Semantic DOM | Implemented and browser-tested | Size-only rendering previously rebuilt each page's semantic children → all five already-rendered page nodes retain identity over four toggles at document revision 1. A sixth previously-undrawn page enters the lazy render range and receives its first semantic node; that is not a replacement. Document-version changes own replacement; size-only draws update geometry. |
| W2.4 Home warm-up | Implemented; controlled baseline missing | Original dev immediate-open first ink 3,116 ms; optimized immediate-open samples 1,088–2,200 ms (latest 1,088 ms), and an earlier warm Home sample 992 ms. No production baseline at the original source was rebuilt, so these are observations, not a like-for-like speedup claim. The existing compiler preparation request and renderer promise are reused; an unconsumed compiler is terminated when Home unmounts. |
| W2.5 Motion gate | Added, not passing exhaustively | Existing round-four 10k-word trajectory assertions are unchanged; a <50 ms long-task gate is added around the same sidebar transition. It reports the remaining failures instead of accepting them. The round-seven sample additionally checks event-to-fade, drawing deferral, one redraw/page and rendered semantic identity. |
| W3.1 Palette | Implemented | Six existing actions newly exposed: Add chapter, New manuscript, three sidebar tabs and Retry preview. View modes, F8, themes and All manuscripts already existed; they are not credited as additions. Default visible options stay 35 → 35 because the shared palette caps each browse group. Search reaches the additional actions. New manuscript reuses Home's dialog and the existing save-before-leave decision, preserving its destination on retry/explicit leave. |
| W3.2 Keyboard | Implemented except full tooltip convergence | Ctrl+K and Ctrl+/ now toggle their own overlays; Home ? opens help outside text fields, without intercepting composition. Two Ctrl+F rows → one “Find and replace” row. Palette/sheet and changed layout tooltips use the shared formatter. Older editor/comment and untouched toolbar tooltip strings still contain hyphens; full notation convergence is not claimed. |
| W4.1 Alignment/chips/colour | Implemented; unread-thread visual sample incomplete | Continue ink x402.39, goal ink x407.99, row ink x393 → x393, x393.01, x393. Reference chip width 127.25 →125.16 px (same text/font), inline padding .20em →.12em. Dark primary OKLCH lightness .73 →.65 using the existing stronger token, not a new colour. Approximate text contrast from the measured colors, converted through Chromium's sRGB canvas: light 6.32 →8.18, dark 8.10 →6.00. The unread thread's inset 2 px stripe is replaced by the existing selected fill; no live unread-thread screenshot/contrast result is claimed. |
| W4.2 Home balance | Intentionally unchanged | Existing history remembers one most-recent chapter per manuscript, already represented by Continue. No recent-chapters list or invented history state is added. |
| W4.3 Touch targets | Implemented and measured | Cite 40×44 →44×44 px on the 390 px touch viewport. Council's Replace summary 20×44 →55×44 px on the current touch viewport, with an explicit 44 px minimum on every viewport. The old 20 px width is council evidence, not a fresh baseline reproduction. |

## SDK evidence

Release: `sdk-v0.1.0-beta.157`, source
`493d29ca2a3494c5d59677e8b83e309b44a28c31`.

| Original | SHA-256 |
| --- | --- |
| LAB release asset | `927cc688a22d0931207d9108b53958e3279f2d2d711342b04ac80c02d8091e26` |
| Staging release asset | `3efb7888ef59b6449ecff7c717b123dfaf94b3ae6257bcae4f1e7113a82a0d4c` |
| Production npm archive | `c44bce54c56239a6489e3f909638a8b900e48e41d286d77e9d9732c7172d199c` |

LAB/staging asset and bundle digests were checked against GitHub release
metadata; `gh attestation verify` verified the repository, workflow and source.
Production uses the exact npm dependency `@mdbase-dev/sdk@0.1.0-beta.157`, with
npm integrity/provenance verification and a committed original for publisher
byte comparisons. Runtime SHA-256 is
`d375ce16a48dec718801704f56ffb6a545247a2793912c2c8e68ceb171ff2537` in all three.

The publisher now authenticates the npm importer/resolution instead of assuming
production is a file dependency. Its staging derivation changes only the SDK
source/integrity and corresponding peer identity, retaining the exact freeze of
other dependencies and comparison of every installed original member.

Idle compiler ownership also covers preparation failure: an already-terminated
worker must not stay in the warm cache and later become a workspace's compiler.
The narrow file was 7 passing / 1 failing before the fix; all 8 tests pass in
the final full-suite run. The
existing worker failure subscription now clears the cache, and Home cleanup
removes that subscription; normal workspace initialization remains the only
initialization path when no prepared worker is available. No retry loop or
separate error state is added.

## Validation

- `rpnpm test:publisher`: 124/124 passing after adapting exact npm intake.
- `rpnpm test`: core 67 passing / 4 pre-existing skips; Writer 370 passing;
  root 126/126 passing; App Node 35 passing / 2 existing skips.
- `rpnpm typecheck`: passing. No lint script is configured in this repository.
- Production, staging, LAB and demo-enabled optimized builds pass their existing
  locale, manifest and exact-environment checks, with explicit `VITE_MDBASE_ENV`.
- Local browser measurements require load below 20. Motion uses real key events,
  `requestAnimationFrame`, `getAnimations()` and `PerformanceObserver`; canvas
  attribute mutations identify bitmap replacement, not just screenshots.
- The old round-four help gate caught removal of the “Find and replace” wording
  while deleting its duplicate. The single surviving row keeps that wording;
  the gate was not weakened.
- The design detector reports only the existing comment-point insertion marker
  and prose blockquote border. Neither is a coloured edge on a rounded item.
- Base polish matrix: 8/8 plus empty/demo-reset recovery pass. Round-six
  viewport phases: 4/4 complete before the quota-copy assertion fails.
  Review regression cases: 18/18 pass, including nonmodal desktop Settings
  shortcuts and Preview-only F8. No lint script is configured.
- Round-two native status/hold/download/merge: an earlier run completed 8/8.
  The handoff rerun completed six cases before `Execution context was
  destroyed, most likely because of a navigation` at hold resolution; a further
  rerun stopped at the same operation in its first case. A final cold-start
  LAB-selected dev run again completed six cases before the same failure at
  line 89. Its log records one initial dependency-optimizer reload, minutes
  before the failing operation, not a proven explanation for it. This is not a
  current full-matrix pass. No cause is claimed and the gate is unchanged.
- Round-seven optimized gate: passes Home help, palette/help toggles, six new
  searchable actions, Add chapter, guarded New manuscript with retry, hidden
  preview motion, five rendered semantic node identities, and four motion
  samples (final 20.0/24.4/31.3/16.9 ms first fade, zero long tasks), plus a
  hidden preview compile with zero canvas mutations. All four phone
  light/dark × normal/reduced cases also pass zero hidden bitmaps → actual
  rendered revision after opening Preview. An initially
  overbroad new semantic assertion counted first rendering of an undrawn page as
  replacement; it now checks the nodes that existed at capture and requires an
  unchanged document revision. The original trajectory gate was not changed.
- A subsequent optimized phone reveal run exposed an intermittent 60-second
  light/reduced timeout after opening Preview. Drawing was relying on an
  observer notification for a visibility-only layout change. The existing
  derived pane visibility now also schedules drawing explicitly, without new
  state or another observer. The final rerun passes all four phone combinations.
- The last full 10k-word round-four dev matrix fails 6/8 cases: light/reduced has
  66/51 ms tasks and dark/reduced 54 ms. Both desktop normal-motion cases pass.
  All four phone cases time out after 60 seconds at `continuePosition`'s
  rendered-revision wait. Preview is hidden there; the corrected visibility
  guard deliberately leaves its last-rendered revision unchanged until it is
  shown. A direct phone check measured zero hidden bitmaps and five after
  opening Preview. No false rendered marker or altered gate is used to obtain
  a pass. The hidden-preview/gate expectation needs an explicit owner decision.
  The preceding matrix, before the visibility correction, passed 5/8 with
  desktop tasks of 53–66 ms. Earlier optimized samples also had isolated
  52/54 ms tasks. The full round-four matrix was not rerun after the explicit
  phone-reveal scheduling fix. None is a full performance acceptance pass.
- The round-six quota fixture still fails its old exact-copy expectation
  `Delete a synced collection before creating another`. Beta.157 instead says
  `Synced collection limit reached` and offers existing-collection/deletion/
  support guidance. The product copy and existing gate are not rewritten to
  obtain a pass. Live quota recovery and the current-collection Manage access
  target still need candidate LAB proof.

The optimized local demo is the existing supported `?demo` route, enabled by
`build:editing-test`; it is not a new account-free sign-in flow. Browser fixture
suites use the dev server because they import the repository's fixture module.

## LAB boundary and owner follow-up

The isolated GCP desk used the registered `lab-next-acceptance` account and LAB
only. Live health reported revision
`13985458d3a7a0d069622cee6bc3b4b75a531ca6`, environment `lab`, public origin
`https://connect-lab.mdbase.dev`, engine unavailable (`null`). The deployed app
was not replaced, so its behavior does not certify the candidate SDK. No test
record or existing grant was changed in this run. The desk was summarized as
partial and destroyed on November 7, 2026 (Australia/Melbourne). No
production/staging service test or deployment was performed.

After merge and the owner's existing LAB deployment workflow, use a fresh GCP
desk/profile and an owned `[test]` manuscript (not somebody else's fixture):

```sh
desk up gcp/writer-r7-proof --profile mdbase-lab --ttl 2h
desk chrome gcp/writer-r7-proof https://lab.mdbase-writer.pages.dev
desk cdp gcp/writer-r7-proof
# Use that command's local tunnel URL and your owned test fixture identifiers.
WRITER_LAB_CDP=http://127.0.0.1:PORT \
WRITER_LAB_COLLECTION=YOUR_TEST_COLLECTION_UUID \
WRITER_LAB_COLLECTION_NAME='[test] YOUR OWN COLLECTION' \
WRITER_LAB_MANUSCRIPT=manuscripts/YOUR-OWN-TEST.md \
pnpm --filter @mdbase-writer/app test:lab:reload-write
desk down gcp/writer-r7-proof --summary 'Record actual results and fixture/grant cleanup here' --outcome partial
```

Run the reload check repeatedly, inspecting actual fresh-context readback rather
than the local save label. It deliberately has no account-password output and
no production/staging URL override. A failed acknowledgement/readback is a gate,
not a reason to clear local data or stop the SDK retry ledger. Separately prove
quota refusal → owner quota repair → same SDK recovery action, Manage access's
current-collection destination, revoked-after-reload copy, Cancel, collection
hint preselection and Install absence on real gates. Those remain unproven.
