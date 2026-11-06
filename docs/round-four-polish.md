# Writer rounds four and five

Implements the round-four plan against `origin/main` at
`2c513a34cff24c63f3a471a5854086d3e66d58c1`, on `polish-r4`.
The three round-three reports and their focus, motion, startup, font and
semantics evidence were checked before changing the corresponding behavior.

## Plan checklist

| Plan item | Status | Implementation or reason |
| --- | --- | --- |
| Overlay exit flash | Done | Keep the filled exit animation until removal. The polish gate samples opacity with `requestAnimationFrame` for 350 ms, rejects any increase or reappearance, and requires removal. |
| Editor font and chip baseline | Done | Use the existing `--sans` font, Atkinson Hyperlegible Next, rather than the unshipped Atkinson family. Align citation chips with that font. Chromium verifies the actual custom font, not just a computed fallback list. |
| Focus follows the task | Done | Open/create/chapter navigation focuses writing; Back restores the originating row; activated palette commands do not restore the opener over their destination. Phone citation insertion reveals Write before focusing it. Reveal requests survive development remounts without stealing search focus. Plain focus no longer recenters a retained chapter. Gates type after these handoffs and verify the actual document/query. |
| Continuity and press states | Replaced in round five | Keep Home visible until the workspace exists. Remove the workspace/initial-editor nested fade and never start a chapter at zero opacity. Desktop panes fade/translate at their final layout instead of interpolating grid columns. Phone panes remain mounted and inert while hidden. Press-fill and moving-tab gates inspect computed styles. |
| Open books directly | Done | Open the first available chapter, or the last edited chapter if it still belongs to this book. Remember that chapter in the existing browser-local recent entry, not a new storage key. The main manuscript remains available in Outline. |
| Development setup error | Not done: no fix needed | Production builds require an explicit environment and use the native SDK entry. The locally served production artifact at its declared origin reaches the native transport-error gate when all authority traffic is blocked, not the unconfigured-development screen. No authenticated production setup was attempted. |
| Honest save feedback and settle | Done | Unsaved text says Saving, not Saved. Existing saved-on-device and remote-sync states remain distinct. The confirmation settles in 400 ms; the gate checks the computed duration. Unchanged merged text requires the explicit Keep mine action. |
| Library Select and language control | Done | Settings uses the pinned shared Select and existing locale runtime, including failed-chunk retention. Remove the redundant top-bar language control. All ten authored catalogues and generated catalogues are updated. |
| Shortcut reference and Tab escape | Done | Home and workspace references render command-registry shortcuts. Ctrl+/ opens the reference. Remove the optional Tab-indentation override: ordinary Tab leaves the editor, even when Escape would dismiss a completion instead. No second escape mechanism is added. |
| Home keyboard, touch targets and identity | Done | Home has the shared command palette; arrows/J/K navigate the list and Enter opens. Coarse-pointer controls have 44 px targets. The top bar supplies the one app mark; the gate's duplicate mark is hidden. |
| Plain vocabulary | Done | Split sidebar, Comment, Whole text, Other notes and explicit conflict/merge instructions replace the identified labels. Demo hides the unrelated untyped-note list. Existing shared setup lead text already explains the collection changes in plain language. |
| Production first-preview profile and optimization | Completed in round five | Production CPU profiles identify repeated full-tree CSL macro lookup and duplicate ordinary-prose parsing. Replace those traversals using their existing syntax boundaries, with no cache. See the round-five measurements below. |
| N4 accessibility semantics | Done | Patch the existing shared page gate to expose main and use h2 setup sections; panel gates stay divs. Settings uses a valid dialog host and a distinct Editor preferences region. Source, search and chapter-comment group headings follow the manuscript h1 without skipping a level. |

## Boundaries and removal

- No dependency, framework, application flag or fallback is introduced. The UI
  pin stays `0.1.0-beta.147`; PR #20 is untouched.
- The pnpm patch changes the canonical pinned shared palette/gate implementation,
  not a Writer fork. Its only consumer is this Writer lockfile. Remove
  `patches/@mdbase-dev__ui@0.1.0-beta.147.patch` and its pnpm registration when a
  separately planned shared-UI update includes destination-owned palette focus,
  the page main landmark and setup heading fixes. This PR does not repin it.
- The only new persisted field is optional `chapter` in the existing
  browser-local recent manuscript entry. It is checked against the book's
  current chapter paths and never sent to Connect.
- Focus and scroll are separate operations at the existing EditorHandle boundary.
  Explicit jumps still select/reveal their target; ordinary focus preserves
  selection, history and the visible scroll anchor.
- Explicit writing-view controls focus the editor. A search-driven expansion
  from Preview only preserves the search field instead; the gate types into
  that field after Enter and verifies that prose has not changed.

## Evidence and limits

All browser mutation is disposable demo data or the SDK in-memory fixture.
The production-startup probe uses a fresh browser with the production artifact
fulfilled locally at `https://writer.mdbase.dev`; all authority requests are
blocked. It checks build-path reachability, not real sign-in or setup success.

The editing profile serves the exact installed 28 MB compiler locally and uses
the production React/Vite bundle with the explicit demo-test build. It does not
measure the deployed CDN, real-account discovery, a slow network or a native
screen reader. The untraced reference first canvas was 1,931 ms; one traced
reference was 2,447 ms, including 1,000.5 ms assembly and 343.2 ms compilation.
Another traced sample was 2,031 ms: worker initialization 113.3 ms,
assembly 847.2 ms and compilation 339.3 ms, with five citation clusters.
The compiler transfer took 90.7 ms and font transfers took 18.4–32.7 ms
in this local harness. These numbers do not support a network-cache change.
These are single-run diagnostic samples, not a before/after performance claim.
The trace identifies citation-style initialization as substantial worker work.
A later rerun took 2,940 ms, with 276.4 ms worker initialization,
1,151 ms assembly and 403.9 ms compilation; compiler transfer was 230.2 ms
and font transfers took 55.4–90.5 ms. This variation reinforces that these
diagnostic samples are not evidence of a startup improvement.

Local raw artifacts are ignored under `apps/writer/out/`: `polish-r4/matrix.json`,
the round-four screenshots, `polish-r4/production-startup.json`, and
`editing/first-preview{,-trace}.json`. The retained-scroll reliability test keeps
its exact visible-text and pixel-position assertions. Main-record reliability
tests now explicitly choose the main manuscript rather than accidentally typing
into the newly defaulted chapter. No prior assertion is dropped.

The expanded polish command runs the existing motion and native-state matrices
plus the new desktop/phone × light/dark × normal/Reduce focus/font/semantics
matrix. Its added semantics rules include main landmarks, heading order,
landmark names, allowed roles and content regions; serious-only axe filtering
is not used for those targeted checks.

## Round-four validation receipts (historical)

These completed commands returned exit code 0. Finite pnpm checks/builds ran
through `rpnpm`; service-dependent browser suites ran locally.
Development-server suites used `BASE=http://127.0.0.1:5488/`.

| Command | Result |
| --- | --- |
| `rpnpm run check` | 0: catalogue checks, TypeScript, app/core tests and 227 root Node tests; existing skips remain. |
| `rpnpm --filter @mdbase-writer/app run build:production` | 0: only the production Connect origin is bundled. |
| `rpnpm --filter @mdbase-writer/app run build:staging` | 0: only the staging Connect origin is bundled. |
| `rpnpm --filter @mdbase-writer/app --pull apps/writer/dist run build:editing-test` and local `test:browser:editing` | 0: production-mode real canvas, editing, cursor movement, undo/redo and startup trace. |
| `rpnpm --filter @mdbase-writer/app --pull apps/writer/dist run build:feedback-test` and local `test:feedback` | 0: desktop/phone feedback; all delivery intercepted. |
| `pnpm --filter @mdbase-writer/app test:browser` | 0: baseline/export and reliability suites, including retained scroll, history and guarded conflict resolution. |
| `pnpm --filter @mdbase-writer/app test:browser:i18n` | 0: locale negotiation/persistence, formatting, narrow picker and failed-chunk retention. |
| `pnpm --filter @mdbase-writer/app test:browser:a11y` | 0: existing accessibility/dialog-focus suite. |
| `pnpm --filter @mdbase-writer/app test:browser:polish` | 0: all three matrices, including the new setup-heading styling and Preview-only search handoff assertions. |
| `pnpm install --frozen-lockfile` | 0: the final patch and lockfile apply without a repin. |
| `git diff --cached --check` | 0. |

The production-origin offline probe also returned 0 with one main landmark and
no script errors. Its native transport-error gate is not evidence of successful
authentication or setup. Desktop and phone setup screenshots were inspected.

Provisional failures were not counted as passes: the styling assertion exposed
a Vite process retaining the old dependency resolution, and a remote sync
captured patch/lockfile metadata during its update. The server was restarted,
the inputs frozen, and affected commands rerun. A separate Preview-only search
probe reproduced a real focus theft; explicit view controls now own that focus
handoff, and the expanded matrix verifies that search expansion does not.

## Round five

Base: `origin/main` at `d514b8c71`, branch `polish-r5`. The authoritative
round-five plan and all three round-four reports were read before implementation.
This section supersedes the earlier incoming-only and grid-interpolation choices.

### Interaction and state

- Logical overlay dismissal ends keyboard ownership immediately. The pinned
  shared palette restores its origin before dismissal or command execution;
  dialogs close their native modal first, then retain an inert manual popover
  solely for the visual exit. Backdrop and panel enter in 160 ms and leave in
  120 ms with ease-in exit. Reduce cancels both. Immediate Escape tests type
  before visual removal, rather than waiting away the defect.
- Home remains visible during workspace creation. Initial nested fades are
  removed. Chapter changes retain at least 80% opacity; pane changes use a
  160 ms fade/translation at final layout, including a 10,000-word manuscript.
  The layout effect resolves the resized text before starting the animation;
  its first painted frame does not wait for nested animation-frame callbacks.
  A pane-toggle CPU profile identified canvas redraws (`drawImage` and `Path2D`)
  overlapping the fade. The existing draw queue now waits for active pane
  animations before redrawing at the new width, leaving the current bitmap
  visible throughout. The long-document gate checks both opacity samples and
  unchanged bitmap dimensions while the animation runs.
  No grid-column interpolation remains. Reduce also cancels owned pane motion.
- Press fills cover primary/secondary controls, rows, tabs and view segments.
  A single tab-strip indicator travels between the equal-width tab cells.
  The lower panel resizes by pointer, arrows and Home/End. Its ratio lives in
  the existing layout entry; the selected upper tab is no longer reset on open.
- The existing recent-manuscript entry holds optional caret/selection and a
  visible-line scroll anchor alongside the chapter. Malformed positions are
  discarded; stale offsets are clamped to the current document. An unmeasured
  development remount must not overwrite the saved anchor with zero. No
  per-keystroke recent-entry write remains. First open starts on the body.
- Home has one Continue writing row from already-held manuscript metadata.
  Search outline replaces the misleading field name; match-navigation guidance
  exists only with a query. The reference groups registry commands and static
  editor-owned keys instead of maintaining a second workspace shortcut list.
- Find uses CodeMirror's supported panel boundary: one row, labelled controls,
  and anchored options/replacements. Native search queries, flags and keyboard
  commands remain authoritative. Preview keeps selectable semantic text but
  removes text-layer and link tab stops; the Preview region is focusable.
- A successful synchronous draft-store write says Saved on this device while
  collection sync stays separate and quieter. Failed storage and unreviewed
  recovery never get this acknowledgement. Existing hold, conflict and remote
  confirmation states are unchanged. Save-mark animation, including delay, is
  capped at 400 ms. Comparison highlights retain their warning fill and border;
  caret-line attribute tokens use the legible muted token.
- Remove the healthy check, repeated demo reset line, touch-menu keyboard
  entries and duplicate setup lead. Reset guidance remains on Home and in the
  Demo tooltip. All new visible strings are authored in the ten catalogues.

### Production measurements

The same local production-mode demo-test harness serves the exact compiler and
font assets, blocks external authority traffic, records a fresh browser trace,
and types at 25 ms per character into 11,000 words. These are diagnostic samples,
not a controlled hardware benchmark or deployed-network claim. Concurrent host
load differs, so timing changes alone do not establish causation.

| Measurement | Before | After |
| --- | ---: | ---: |
| Startup load average, 1/5/15 minutes | 11.91 / 12.85 / 13.22 | 10.30 / 10.45 / 12.06 |
| Blank-frame median | 16.7 ms | 16.7 ms |
| Open click to editor | 563.1 ms | 260.4 ms |
| Open click to drawn canvas | 2724.4 ms | 1660.6 ms |
| Worker initialization | 309.3 ms | 177.3 ms |
| First assembly, five citation clusters | 1240.4 ms | 615.1 ms |
| First compilation | 466.0 ms | 484.5 ms |
| CSL named-node lookup self samples | 2754 | 89 |
| Typing load average, 1/5/15 minutes | 14.78 / 13.51 / 13.43 | 12.01 / 10.81 / 12.13 |
| Typing keydown to next frame, p50 / p95 | 45.4 / 58.9 ms | 24.1 / 34.7 ms |
| Typing maximum frame delay | 72.1 ms | 74.3 ms |
| Typing parseInline / finishLeaf self samples | 406 / 274 | 196 / 137 |

The final production-mode correctness run on November 6 used the completed
round-five source. At startup load 18.18 / 23.85 / 25.17, the blank-frame median
was 16.7 ms, click-to-editor 464.3 ms, click-to-drawn-canvas 1618.9 ms, worker
initialization 202.9 ms, assembly 461.5 ms and compilation 359.7 ms. The
11,000-word typing run, at load 21.85 / 24.02 / 25.17, measured p50 / p95
36.6 / 45.6 ms and a 49.0 ms maximum; every profiled character was retained,
and editing, cursor movement, undo and redo passed against the real canvas.
These additional high-contention receipts do not replace the diagnostic
before/after comparison or establish a deployed performance improvement.

The startup trace identifies `XmlJSON.getNodesByName` recursively walking the
whole CSL style on each macro expansion. CSL macros are direct style children;
the pinned citeproc patch restricts that lookup to those children and leaves
other recursive queries unchanged. Unit coverage compares every bundled style
against the original recursive lookup, including repeated references. This is
not memoization. Remove `patches/citeproc.patch` when the pinned upstream
implementation provides the same lookup boundary.

The typing profile shows full Markdown translation under `openEmbeds` in
addition to CodeMirror's required parse. Bodies without the embed introducer
`![[` cannot have embedded records, so they no longer invoke that translation;
reading-order traversal uses the same exclusion. Empty dependency-problem maps
also skip a diagnostics translation with nothing to report. Embeds and actual
dependency errors continue through the canonical translator; no collection
semantics or approximate reference parser is added.

The shared-UI patch remains local to this lockfile and adds visual presence
separately from logical open state. Remove it when the shared package includes
these lifecycle, focus and setup fixes. The only new persisted fields are the
optional recent-entry position and the existing layout entry's sidebar ratio;
neither is sent to Connect. PR #20 and lower-panel removal are untouched.

### Round-five gate coverage

The existing `test:browser:polish` command remains the CI entry, with the dev
server at `http://127.0.0.1:5320/?demo`. Its three existing matrices now cover
immediate overlay keystrokes, origin/destination focus, real backdrop samples,
route visibility, press fills, traveling tab styles, custom Find actions,
comparison fill, contrast, Preview tab order, long-document pane motion,
Continue caret/scroll, layout persistence, phone count, save timing, local-save
truth and blocked storage. Production startup/typing traces remain in the
existing editing browser test. Raw evidence is ignored under `out/polish*`
and `out/editing`; timings above retain the before/after diagnostic receipt.

No live collection, account, deployment, non-Chromium browser, native screen
reader or deployed-network performance was tested by these disposable fixtures.

Browser checks use disposable local fixtures and isolated contexts. The
production editing harness owns and closes its ephemeral HTTP server and
Chromium instance; the shared-browser visual-review tab was also closed.

### Round-five validation receipts

Completed on November 6, 2026, against the final runtime and test source. All
commands below returned exit code 0. Browser matrices ran locally against the
development server at port 5320 with `?demo`; the three polish scripts are the
unchanged constituents of CI's `test:browser:polish` entry point.

| Command | Result |
| --- | --- |
| `rpnpm run check` | Catalogue/source guards and typechecks pass; 66 core, 349 app Vitest, 85 app Node and 227 root Node tests pass. Four existing core and two conditional app Node skips remain. |
| `rpnpm run build:production` | Production bundle targets only production Connect. |
| `rpnpm --filter @mdbase-writer/app run build:staging` | Staging bundle targets only staging Connect. |
| `rpnpm --pull apps/writer/dist --filter @mdbase-writer/app run build:editing-test` | Explicit `VITE_MDBASE_ENV=lab`; production-mode demo bundle targets only LAB Connect. |
| Local `test:browser:editing` | Real canvas, exact retained text, cursor movement, undo/redo and production startup/11,000-word typing profiles pass. |
| Local `node apps/writer/scripts/browser-test.mjs` | Baseline workflow, editing, search and export checks pass. |
| Local `node apps/writer/scripts/browser-polish-test.mjs` | Eight desktop/phone, light/dark, normal/Reduce cases plus empty-manuscript/reset recovery pass. |
| Local `node apps/writer/scripts/browser-polish-r2-test.mjs` | Eight native-state cases pass, including immediate truthful local-save acknowledgement, blocked storage and computed conflict-highlight styles. |
| Local `node apps/writer/scripts/browser-polish-r4-test.mjs` | Eight interaction/semantics cases pass, including immediate Escape typing, palette-origin focus, computed backdrop samples, long-document motion and exact Continue position. |
| Local `test:browser:reliability` | All 24 scenarios pass, including retained chapter history, compiler failures, recovery and guarded conflict resolution. |
| Local `test:browser:i18n` | Ten locales, negotiation/persistence, authored translations, formatting and failed-chunk retention pass. |
| Local `test:browser:a11y` | All 29 existing scene/focus checks pass at 375 and 1280 px. |
| Local `node apps/writer/scripts/browser-find-panel-test.mjs` | Single-row geometry, named pointer/keyboard options and anchored controls pass at 1280, 390 and 320 px. |

There is no configured lint script. No lint configuration was added solely for
this change. Existing conditional skips are not reported as passes.

Provisional failures are excluded from these receipts. The strengthened gates
exposed real retained-palette focus, Find geometry, initial-chapter animation
and canvas-redraw contention defects; those mechanisms were corrected rather
than weakening the keystroke or computed-style checks. Fixture waits now let
real save/compile status rows settle before measuring pointer geometry and
scroll anchors, not before the immediate Escape keystroke gate. One earlier
combined polish run was interrupted when its development server exited with
SIGTERM (143). After restarting the owned server, all three constituent
matrices completed against the same final source.
The owned port-5320 development server was stopped after validation; browser
contexts and the production editing server were closed by their harnesses.
