# Writer round 8

Branch `polish-r8` starts at fresh `origin/main` `52b2197`, after reading
`council/writer/plan-round-8.md` and both round-7 source reports (Opus and Sol).
No SDK/UI fork, dependency change, deployment, merge, lower-panel change or
drag-insertion-marker change is part of this patch.

## Disposition and measured regression coverage

The before figures below are fresh local reproductions, not the council's live
measurements. The browser harness mounts the real workspace inside the existing
shared collection gate using a local demo/test backend. It is presentation proof,
not a substitute for a live account, acknowledged remote writes or LAB recovery.

| Plan item | Disposition | Before → after / evidence boundary |
| --- | --- | --- |
| 1. Stuck-sync bar | Writer presentation fixed; live backoff recovery remains unproved | Desktop overflow: 1440 → 1566 px and 1042 → 1389 px before; final scroll widths equal the 1440/1042 px viewports. Phone overflow: 390 → 416 px before; final width 390 px. One canonical status replaces the shared warning, responsive duplicates, companion status and extra live region. Final header stays 48 px desktop / 78.59 px phone before and during delayed sync; prose shift 0 px. ZIP action remains visible, single-line, hit-testable and produces a download in both themes at all three widths. “Stay online” is absent. Existing online retry remains; focus now invokes the same real session flush for unsettled work. Unit regression: clean focus does nothing, dirty focus retries, online retries, disposed listeners do nothing. SDK's real network-backoff reset cost has not been measured here; do not claim the source report's 27.4 s recovery is fixed. |
| 2. Collection hint | Not done: shared front-door/UI boundary | UI beta.147 calls `mdbase.signIn({signal})`; SDK beta.158's `MdbaseApplicationRequestOptions` contains only `signal`. The strict front door calls authorization without forwarding a collection hint. Shared action/hint plumbing must be fixed and repinned. No Writer authorization adapter or duplicate chooser is added. Zero new live sign-ins tested. |
| 3. Readable setup list | Not done: shared gate boundary | Shared `SetupReview` renders only `change.message`, despite receiving `change.target`; the pinned SDK's ordinary setup sentences repeat without those names. Writer delegates this flow to `CollectionGate`, which has no setup-row renderer extension. Fix and repin the shared renderer/message source rather than replacing Writer's gate. Existing shared applying progress is retained; no live setup timing claim. |
| 4. LAB reload/write test | Picker implementation and unit regression fixed; live run not done | Collection checkbox assumption → exact named `option`, verified `aria-selected`, exactly one selected collection, and create permission disabled. New helper regression failed with the old checkbox lookup and passes with the real single-select contract. Existing real acknowledgment, isolated readback, scope checks and restoration stay intact. No LAB desk/account was used in this pass. |
| 5. Revocation across reload | Not done: SDK reason identity is lost | Pinned SDK worker maps `reason === "revoked"` to `"unauthenticated"` before the app receives its problem. Shared gate then legitimately shows authentication copy. Writer cannot distinguish that case from an actual expired authentication; no speculative local persistence or generic-auth relabeling is added. Source report `access_removed` and exact installation-revoke paths are distinct, not contradictory evidence. Needs SDK reason preservation and shared mapping at repin. |
| 6. Sidebar prose dimming | Fixed | Normal-motion sidebar toggle previously animated `.write` from opacity .7 and translateX(6px). Now 0 prose animations and computed opacity 1; Reduce also 0. Actual view/chapter transitions remain; the existing R7 first-sidebar-frame test now samples `.outline`, while the new gate explicitly prohibits prose fading. |
| 7. Tabs/count collision | Fixed | At a real 271 px sidebar with Sources 9 / Comments 2, final text gaps are 20.06 / 20.08 px (minimum asserted 12 px). Tracks fit their content. Active underline follows each actual button's width rather than the obsolete equal-third pseudo-element; keyboard selection and visible active indication are asserted. Lower-panel selector and behavior remain unchanged. |
| 8. Flat primary hover | Fixed | Removed Writer's redundant primary rest override, which made rest equal hover. Shared tokens now produce light OKLCH L .47 → .41 and dark .65 → .73. Regression waits for the actual CSS transition and compares the final shared strong-accent color, not a different color serialization during the first frame. |
| 9. Settle on initial load | Fixed | Initial `mdbase-settle` animation count 1 → 0; a real editor change and completed save still produces 1. Shared `saveToneSignal` supplies the transition; only presentation state is added, not a new saved/durability state. |
| 10. Tall reference | Fixed | Desktop 1 → 2 columns; phone remains 1. DOM/reading order unchanged; groups don't split; no horizontal dialog overflow. Both actual keyboard-opened surfaces are asserted. |
| 11. Cold preview / consent-to-Home | Dropped first | No compiler/loader redesign or new warm-up path. The council's cold-assembly and live 6–7 s consent figures are not remeasured or claimed improved. Existing compiler readiness/editing gates remain mandatory. |

## Red tests and gate maintenance

- New R8 browser gate before product changes: **2/14 passed, 12 failed**.
  Sync geometry, hover, normal sidebar motion, counted tabs, initial settle and
  desktop reference all failed; Reduce and the phone reference already passed.
  A later intermediate run was 12/14: the remaining 1042 px overflow prompted
  compact status at the existing medium-width chrome, not a looser assertion.
- New focus retry unit: **35/36 passed before** (no retry on focus); new
  canonical-connection unit: **6/7 passed before** (Offline was hidden by the
  local-checkpoint label). Both exercise the existing mechanisms, not a retry loop.
- LAB picker helper unit: **0/1 before** with collection checkboxes.
- Existing R2 now reads the single canonical notice instead of the deleted
  long/short/companion nodes. It still checks real local checkpoint bytes,
  offline/reconnecting identity, absence of remote Saved, quota failure, protected
  holds, downloaded recovery, merged text and accessibility semantics.
- Existing R4 checks the actual selected tab underline instead of a hidden
  equal-width pseudo-element. Its timing, motion, interruption and long-task
  budgets are unchanged. R7's sidebar-frame target correction does not relax its
  latency/long-task/hidden-preview assertions; R8 separately guards unchanged prose.
- The original polish gate required the removed prose fade. It now probes the
  actual sidebar's existing 120 ms exit / 160 ms entry, with the same continuous
  trajectory and Reduce requirements. This changes the target to the intended
  moving surface, not the animation budget or a missing-motion exemption.
- Extracted/compiled catalogues remove the unused “Saving to collection…” message
  deleted with the redundant companion status. No untranslated strings are added.

## Validation receipts

Final local and GitHub results are recorded in the PR description. Required cold
CI reproduction deletes `apps/writer/node_modules/.vite` before starting Vite,
then runs baseline, reliability, i18n, accessibility and the complete polish
chain in CI order, without opening/warming the demo first. Failure counts and
timeouts are not raised. Finite checks/builds use `rpnpm`; browser gates run
locally under load 20. The final GitHub check, not this document, is the authority
for CI success.

Unproved: live hint/setup/revocation fixes; live reconnect-backoff duration;
real LAB reload/write with the repaired picker; consent-to-Home/cold-assembly
improvement; real touch hardware, Safari and spoken screen-reader output.
