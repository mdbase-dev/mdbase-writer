# Writer UI beta.158 adoption

Branch `writer-ui158` starts from fresh `origin/main` at
`87611eaa336c2808521cb82d82d422aca2b9eea6`, then rebases onto main's SDK160
intake at `4978743b960b4f40c25e5cafd479afff66ba5ccc`. No merge or deployment is part of this change.

## Package and ownership boundaries

- UI and i18n are pinned exactly to `0.1.0-beta.158`. Production SDK retains
  main's exact `0.1.0-beta.160`; the signed LAB original is upgraded to beta.159
  so the live test exercises the requested recovery fixes without contacting production.
  Staging's original is unchanged.
- The local Dialog/CommandPalette/presence adapter is deleted. Dialogs and the
  palette use their published implementations directly. Writer's remaining
  Popover is menu composition over the shared `useOverlay`/`useMenuPopover`,
  not an alternative presence or animation implementation.
- The old optional-presence/WAAPI Dialog and palette patches are deleted; the
  shared hook owns retention and CSS owns motion. Its elapsed exit timer is
  replaced by the actual browser animations' completion promises, so a delayed
  first paint cannot truncate an exit. Small non-redundant fixes
  remain: release native modal focus immediately into an inert visual exit
  (CSS discrete display/overlay transitions preserve the native backdrop),
  preserve the editor selection on backdrop mousedown, and reset the palette's
  query in a layout effect before its reopened input can accept typing.
  The whole patched dependency cannot yet go: beta.158 still embeds production app URLs,
  has duplicate/missing collection-screen landmarks and setup headings, and
  does not clear an account quota notice when collection counts change.
  Removing those existing fixes fails the environment target and R6-review
  gates. They remain as a smaller beta.158 patch, not new recovery adapters.
- The lower panel's layout and the drag insertion marker are unchanged. Its
  existing presence consumer mechanically switches to the shared hook/ref.

## Shared recovery: real LAB proof

`scripts/lab-opening-recovery-test.mjs` serves the actual LAB build's bytes
inside an isolated GCP LAB browser at the manifest's exact LAB origin using
browser request routing. Nothing is deployed. The SDK's real Worker, WASM,
grant, native collection and LAB services run normally; there is no test SDK,
fabricated snapshot, synthetic API success response or SDK method replacement.

On LAB revision `373c4a4e78e821e45a330e156a019a7aa635cfe8`:

| Injection | Observed result |
| --- | --- |
| Abort the actual selected collection's log-token request | One refused request reaches the real named failed-open screen. Restore transport and click the actual shared Try again once: one new log-token request, native synchronization and Home in **7,771 ms**, with the same document `performance.timeOrigin`. |
| Corrupt the locally served signed runtime WASM, retaining HTTP 200 | Real asset verification fails. Connect registration itself returned HTTP 200. Writer says something went wrong while opening, **not** that Connect couldn't be reached. This integrity/startup failure correctly offers Reload, not an unsafe integrity retry. |

Sanitized receipts are in `docs/evidence/writer-ui158-lab.json`. No record or
setup was written. Both test contexts and their exact run-owned installations
were closed/revoked; the three exploratory installations were also revoked.
The missing optional locally served compiler asset is a normal 404; this lane
does not claim compiler/deployment acceptance.

The checked-in test accepts only the exact LAB origin, a registered LAB account,
an isolated desk CDP tunnel and an existing named `[test]` native collection.
It refuses other network origins, disables collection creation in consent,
captures only its own installation IDs and verifies cleanup. To repeat:

```sh
# From apps/writer, after provisioning a disposable GCP mdbase-lab desk:
rpnpm --pull dist build:lab
WRITER_LAB_CDP=http://127.0.0.1:PORT \
WRITER_LAB_COLLECTION=YOUR_TEST_NATIVE_COLLECTION_UUID \
WRITER_LAB_COLLECTION_NAME='[test] YOUR COLLECTION' \
pnpm test:lab:opening-recovery
# Summarize and destroy your desk afterwards.
```

## Round-8 items deliberately not implemented

| Item | Published-package limitation |
| --- | --- |
| 2: preselect consent's collection hint | SDK159/160 already derive a hint from the requested collection URL and forward it through `selection.approve`. The public sign-in options expose only `signal`, and UI158 has no separate consent-preselection override for Writer. Nevertheless, the intended collection was **not** preselected in the real LAB run. The shared boundary losing or ignoring that hint was not isolated; this is an unresolved end-to-end limitation, not proof that SDK hint forwarding is absent. No Writer consent fork or private-API override is added. |
| 3: readable setup names | UI158's `SetupReview` renders only `change.message`; `change.target` is merely its React key. SDK159's `application/setup.js` still generates generic repeated contract/type/schema messages. The shared setup gate exposes no row renderer. No Writer setup fork or new package patch is added. |
| 5: revoked identity across reload | SDK159's optional session hint persists only `{v, signIn, collections}` for unselected/opening/setup-required/ready states, not a revoked problem/reason. Signed-out snapshots clear it. The shared front door cannot restore a revocation classification it no longer has. No app-side revoked flag or relabeling of generic authentication errors is added. A fresh live revoke/reload is not claimed here. |

## Regression and gate intent

- The new shared-gate consumer test requires one selected-ID `select` action
  and zero idempotent `start` actions after Try again. The LAB test separately
  requires actual new opening traffic and unchanged document identity.
- Home and Workspace regressions exercise a real retained exiting shared
  Dialog, require immediate focus return and inertness, then dispatch logical
  Dvorak-shaped Ctrl+K from the actual focused element before removal.
  The unpatched Dialog passes **0/2**; the focus-handoff patch passes **2/2**.
  Existing R4 gates additionally require every character typed immediately
  after pointer/Escape dismissal and an empty query on immediate reopen.
  Reconnect/save behavior is not changed.
- The new shared primary hover fill coincided with Writer's old pressed fill.
  Writer now darkens the shared strong-accent token for a distinct press.
  R4's unchanged press-fill assertion catches the regression in both themes,
  including reduced motion.
- UI158 intentionally changes the shared `--sans` token and bundled font from
  Atkinson Hyperlegible Next to IBM Plex Sans. R4 now expects that published
  family, still requiring Chromium to prove an actual custom font was used
  rather than accepting a system fallback. Writer adds no font override.
- The motion gate now samples the native shared palette dialog rather than
  the deleted custom backdrop. Full entry/exit remain 160/120 ms and Reduce
  remains animation-free. CSS reversals shorten their duration automatically;
  probes reverse during a measured mid-trajectory frame and capture native
  transitions at DOM commits as well as animation frames, so a compositor-run
  shortened reversal is recorded even if the next frame callback is delayed.
  Both directions must stay within the original budgets, with continuity and
  eventual removal.
- Reliability's double navigation guard now targets the current
  `data-open=true` dialog rather than matching its predecessor's retained exit
  too. Both save-guard interactions and the merged remote/local text assertions
  remain. The backdrop cancellation test sends the shared Dialog's real click
  event, not the deleted adapter's mousedown event.
  R8's reference cases locate the unique accessible dialog at page scope,
  because the published shared Dialog portals outside the fixture host;
  the two-column/one-column and overflow assertions are unchanged.
  These assertions exposed shared CSS loaded after Writer's override: the
  desktop reference shrank to 560 px and one column. The more-specific
  `.mdbase-dialog.shortcuts-dialog` width restores the intended desktop
  reference without depending on stylesheet injection order.
- No timeout, accessibility severity, save assertion, latency budget or
  cold-optimizer requirement is relaxed. CI's required check must still pass on
  GitHub; local passes alone are not release evidence.
- A final cold run exposed the shared hook's exit timer removing a palette
  with opacity still **0.88**. A regression pauses a real CSS exit beyond its
  120 ms nominal duration: it fails with the timer and passes with completion-
  owned retention, then requires removal after the real animation finishes.
  GitHub also caught a probe that skipped its narrow reversal window between
  paints. Motion probes now pause and advance the real browser animations in
  eighth-duration steps; the same continuous-sample, 160/120 ms duration,
  reversal-continuity, removal and reduced-motion assertions remain intact.
- Final GitHub CI caught a real phone Continue regression: Editor cleanup
  overwrote the captured position after the workspace header had detached,
  moving visible text by **5.5 px** with the new font. Position capture now
  belongs to the parent's layout cleanup, before its header is removed;
  the child no longer overwrites it. The focused phone reproduction improves
  to **0.5 px**, within the unchanged 2 px gate. R4 also checks Back/Forward
  restoration after a distinct scroll, covering navigation without the
  explicit Manuscripts-button capture.

Unproved: naturally occurring outages (the failure injections are explicit),
production/staging live acceptance, post-deployment/offline-shell behavior,
the three dropped shared-package features, and any new live write/reload claim.
