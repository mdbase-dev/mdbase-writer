# Writer round 6

Started from `6742160cbbf117c6fe448de35b0a2d597cac865f`, then rebased onto
`cea3cdd15c4f8243b5b9d3010c1382d352886317` on `origin/main` before handoff.
This change does not modify PR #20 or remove the lower panel.

## Interaction gates

### PR 59 review follow-up

The review regressions are registered in
`apps/writer/scripts/browser-polish-r6-review-test.mjs`, at the end of the
complete polish suite. They use keyboard typing for Find (not `.fill()`),
and compare every loaded document body before and after the search.

| Review item | Regression gate |
| --- | --- |
| 1 | Desktop Settings: real Ctrl+S invokes Writer save and prevents the browser action; F8, Ctrl+K, Escape and Ctrl+, remain usable. |
| 2 | Desktop/phone, Write/Preview: type a Find query with the keyboard, assert the field value and unchanged document bodies; desktop split layout and its saved preference stay unchanged. |
| 3 | Hold a chapter open indefinitely; the editor is usable within the 2 s runner allowance for the 400 ms hold, and text typed before/after releasing the chapter stays contiguous in the same document. |
| 4 | Fail the compiler WASM fetch, press F8 and assert “Could not check manuscript problems”, not an empty-problem claim. |
| 5 | Preview-only F8 announces through one non-inert, non-hidden live region. This is a DOM/accessibility-state gate, not screen-reader speech testing. |
| 6 | Phone Preview → More → Settings → Escape returns focus to More. |
| 7 | Refuse title leases during Home mounting; the one retry recovers the real chapter title. |
| 8 | Put the recent manuscript behind 55 newer rows: Continue still appears once. Typing a query hides the card and shows ordinary matching rows; clearing the query restores it. |
| 9 | Click Add at quota, then free a slot through the SDK fixture's count update; Add returns without a reload. |
| 10 | Source assertion rejects the obsolete local-app override comment. No interactive behavior changes in this item. |
| 11 | Hold the initial index, type in the main document, await autosave, release the index, then type again; both strings stay together in the main document. |
| 12 | Submit Add chapter with real input while the index is held: creation waits, then preserves existing paths and the new embed/reading-order entry. Unit gates also deliver an old index after a newer watch index and assert the newer snapshot survives. |

The new browser gates were run against `d00de653` before the fixes and
reproduced the reviewed failures. The title-lease fixture was tightened to
cover StrictMode mounting, then separately verified red on the old code.
Both new index unit tests were also red on the old code. The tests wait for
loaded records, saving, compilation, palette selection and focus state.
Local runs use `BASE=http://127.0.0.1:5321/` because another checkout owned
5320 when validation started; CI retains its normal dev server on 5320 with
`?demo`.

The complete serial polish suite passed, including all 15 review gates.
An earlier run exposed the old test's assumption that Find changes split
view to editor-only; its pane-transition setup is now explicit and still
checks the same opacity/Fit behavior. Another overlapping Chromium run
reported `Target crashed`; no assertion was relaxed, and the standalone
round-six gates and subsequent complete serial suite both passed. Both Node
22 and Node 24.19.0 checks and all LAB/staging/production destination builds
passed through `rpnpm`. Optimized local editing with a real Preview canvas
and desktop/phone feedback with intercepted delivery also passed.

No live account, customer collection, deployment or Cloudflare credential is
used by these tests. The existing owner-run LAB route below is unchanged.

Run the development server at `http://127.0.0.1:5320/` with `pnpm dev`.
The registered polish suite uses `?demo`; it waits for workspace, focus and
rendered-revision state rather than assuming a click has settled.

| Fix | Gate |
| --- | --- |
| Environment isolation | Deployment/script unit tests cover LAB and staging defaults, missing/foreign overrides, shared-switcher missing configuration, adjacent foreign bundle destinations and missing verifier targets. Round 6 opens the actual switcher and checks LAB Editor/Reader links with a LAB-only collection ID. |
| Phone toolbar | Round 6 types into the editor and waits for the pending and saved states. Editor position and toolbar height remain stable; the title has at least 100 px and there is no third row. |
| Phone Settings | Round 6 opens Settings from More and immediately sends Escape and typing while the menu exits. It reopens Settings, checks native modality, sends 35 Tabs and 35 Shift+Tabs, and checks that the focused control is visible and center-hit-testable inside the sheet. Escape followed immediately by typing must reach the chapter. Closing popovers use the shared input lock so their old handlers cannot consume the sheet's keys. |
| Chapter Find | Round 6 invokes Find through More on phone and the palette on desktop, enters a real query, presses Enter and Escape, and checks the phone controls' 44 px targets. |
| First frame | A DOM observer captures the first workspace frame: 124 words, resolved Earthworms reference, paper, and final Export background. No workspace mount colour transition. |
| Continue | Round 6 edits Earthworms, returns Home, waits for its actual title, checks one manuscript entry, then Continue and immediate typing at the saved caret. |
| Preview pane moves | Round 6 sends the pane shortcut and samples actual frames: preview opacity stays 1, with no preview animation or delayed second Fit change after layout. Round 4 retains pane/reduced-motion gates. |
| First paper and failure | Round 6 observes the paper shell before canvas, injects invalid WASM into asset fetches only, checks plain error copy and technical console diagnostics, and types successfully after failure. Reliability separately covers HTTP/font/renderer retry paths. |
| Empty F8 | Round 6 uses a clean native fixture and sends F8 and Shift+F8. Each key must mutate the existing CodeMirror live region with “No manuscript problems.” A real template-setting warning must not be announced as an empty manuscript. |
| Accessible names/contrast | The accessibility suite includes label-content-name-mismatch. Round 6 checks the reported citation-on-comment styling state with axe in both themes; that contrast state is deliberately synthesized, not claimed as a naturally created comment. |
| Reading and commands | Round 6 inserts a quote and footnote citation with real editor input, checks the rendered quote without its marker and the Darwin chip, and selects exact palette commands with ArrowDown and Enter. It also checks full-width source titles and that Cite does not overlap them with coarse pointers at desktop and phone widths. Core tests check footnote inline offsets; the polish suite checks command groups. |
| Collection limit | Round 6 clicks Add a collection in the SDK test fixture, waits for the quota result, and checks that guidance replaces the action, stays on screen on phone, offers Manage access, and has no retry button. No live account quota is changed. |

`test:browser` also protects chapter creation, source navigation, exports,
nonblocking discovery, conflicts and recovery. `test:browser:i18n` needs
`BASE=http://127.0.0.1:5320/` when using this server. Finite checks and builds
run with `rpnpm`; browser tests run locally.

## Performance and scope limits

An optimized release-mode LAB-targeted demo build was profiled locally with
the installed compiler WASM. It was not live production, a cold compiler
download, or a real LAB account. The initial profile reached drawn paper at
2364.1 ms from navigation (load averages 7.30/8.82/10.39). A later profile
reached it at 2451.2 ms from navigation, 1431.9 ms from manuscript click
(load 7.87/8.64/8.99). An intervening high-load run took 3094.1 ms from
navigation (load 18.95/17.49/12.90). After integrating current main, a run
reached paper at 3864.6 ms from navigation and 3008.9 ms from manuscript
click (load 15.47/12.87/12.08; compiler initialization 417.1 ms).
These are observations, not evidence
of a speedup. No speculative preload, cache or compiler rewrite was added.
The full trace stays in ignored local `apps/writer/out/editing/` artifacts.

The observed BODY step after the final preview control is browser chrome:
`document.hasFocus()` becomes false, BODY has no tabindex, and the next Tab
reaches the app switcher. No whole-page focus trap was added to suppress it.

The initial paper shell is A4; a collection's custom template may use a
different page size once typeset. When collection discovery is slow, editing
still opens without waiting for metadata; counts/references then reflect
the chapters actually loaded, rather than a fabricated complete total.
No extra route fade was added: the higher-priority final-frame and unchanged
preview requirements take precedence. Real touch hardware, Safari,
screen-reader speech and live cross-app authorization are not qualified here.

## Owner's LAB deployment after merge

There is an existing CLI route. The GitHub deployment workflow exposes
staging and production, not LAB. No deployment is performed by this PR.

From a clean checkout of the merged `main`, with the owner's existing
Cloudflare account ID and Pages Edit credentials configured:

```sh
git switch main
git pull --ff-only origin main
pnpm install --frozen-lockfile
pnpm --filter @mdbase-writer/app deploy:lab
node apps/writer/scripts/verify-connect-target.mjs lab \
  --origin https://lab.mdbase-writer.pages.dev
```

If credentials are unavailable, stop and have the owner configure them.
Do not substitute `deploy:prod`, request a production deployment, or upload
new compiler assets for this polish change.

`deploy:lab` selects `MDBASE_ENV=lab` and runs
`apps/writer/scripts/deploy-pages.mjs`. That script builds with the LAB
Writer origin, `VITE_MDBASE_ENV=lab`, LAB Connect and loopback endpoints,
the short source SHA and the demo flag. Vite supplies LAB Editor and Reader
URLs from the same target configuration. It checks the manifest, bundle
destinations, the Pages 25 MiB per-file limit and the `/wasm/*` Functions route.
It then runs Wrangler 4.120.0 Pages deploy for project `mdbase-writer`,
branch `lab`, with the 12-character source SHA and `--commit-dirty=true`.
The resulting alias is `https://lab.mdbase-writer.pages.dev`.
WASM continues through the existing `WRITER_ASSETS` binding to
`mdbase-writer-assets`; this change needs no R2 asset migration.

After deploying, use a registered LAB account to verify actual Writer to
Editor/Reader handoffs, including the collection query. The local gates
prove destination construction, not those deployed apps' authorization.
