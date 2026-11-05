# Writer round four

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
| Continuity and press states | Done | Keep four desktop grid tracks so view changes interpolate. Phone panes remain mounted, fade/translate and become inert while hidden. Route/chapter entrances and control press states use 120–160 ms transitions. Existing overlay reversal and dynamic Reduce gates remain. Route continuity is an incoming transition, not a retained outgoing-route copy. |
| Open books directly | Done | Open the first available chapter, or the last edited chapter if it still belongs to this book. Remember that chapter in the existing browser-local recent entry, not a new storage key. The main manuscript remains available in Outline. |
| Development setup error | Not done: no fix needed | Production builds require an explicit environment and use the native SDK entry. The locally served production artifact at its declared origin reaches the native transport-error gate when all authority traffic is blocked, not the unconfigured-development screen. No authenticated production setup was attempted. |
| Honest save feedback and settle | Done | Unsaved text says Saving, not Saved. Existing saved-on-device and remote-sync states remain distinct. The confirmation settles in 400 ms; the gate checks the computed duration. Unchanged merged text requires the explicit Keep mine action. |
| Library Select and language control | Done | Settings uses the pinned shared Select and existing locale runtime, including failed-chunk retention. Remove the redundant top-bar language control. All ten authored catalogues and generated catalogues are updated. |
| Shortcut reference and Tab escape | Done | Home and workspace references render command-registry shortcuts. Ctrl+/ opens the reference. Remove the optional Tab-indentation override: ordinary Tab leaves the editor, even when Escape would dismiss a completion instead. No second escape mechanism is added. |
| Home keyboard, touch targets and identity | Done | Home has the shared command palette; arrows/J/K navigate the list and Enter opens. Coarse-pointer controls have 44 px targets. The top bar supplies the one app mark; the gate's duplicate mark is hidden. |
| Plain vocabulary | Done | Split sidebar, Comment, Whole text, Other notes and explicit conflict/merge instructions replace the identified labels. Demo hides the unrelated untyped-note list. Existing shared setup lead text already explains the collection changes in plain language. |
| Production first-preview profile and optimization | Not done in full | The production-mode editing gate now records first canvas paint, worker initialization/assembly/compile timings, resource timing and a CPU trace. The measured citation-style parsing/compilation is not removed or hidden behind a speculative cache. No defensible startup-speed improvement is claimed; this optimization remains outstanding. |
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

## Validation receipts

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

Owned Vite development/preview servers were stopped, the shared-browser review
tab was closed, and suite-owned Chromium instances were closed. No listener
remained on the two owned ports, 5488 and 8892.
