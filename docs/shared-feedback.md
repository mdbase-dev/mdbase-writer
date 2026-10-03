# Private feedback integration

Writer uses the shared `@mdbase-dev/ui/feedback` form, screenshot capture/markup
and verification. There is no new delivery adapter, telemetry or persistence.
The provider sits above the application error boundary and connection/workspace
lifetimes. Quiet topbar entries work on desktop and mobile; failure screens also
provide a report entry.

Fixed connection/manuscripts/manuscript identifiers, deployment environment and
build ID identify the app. Collection names and diagnostics require consent.
Manuscript titles, record paths, credentials and raw exception text are never
passed to the reporter. Visible save/open/preview/export failures nudge the bug;
normal typesetting diagnostics, cancelled operations and background refreshes do
not. Capture-phase keyboard shortcuts ignore open-dialog targets, including F8.

## Release dependency

The integration now uses the published `@mdbase-dev/ui@0.1.0-beta.124`, which
contains these exports and was published through the coordinated Connect
release. The dependency and lockfile use that actual version. Repeat a fresh
frozen-lockfile install, full CI and intercepted browser acceptance; local
worktree links are not release evidence.

First deploy the compatible Worker through guarded cloud-ops, with exact Writer
CORS origins and environment-specific Turnstile hosts. Enable the build with:

- `VITE_MDBASE_FEEDBACK_URL`: approved environment's `/v1/feedback` endpoint.
- `VITE_MDBASE_FEEDBACK_TURNSTILE_SITE_KEY`: that environment's public widget key.

Missing/invalid endpoints hide feedback. Deployment workflows map the
environment-scoped public variables `MDBASE_FEEDBACK_URL` and
`MDBASE_FEEDBACK_TURNSTILE_SITE_KEY` to those build variables. Keep them unset
until Worker CORS policy, widget hosts and live acceptance are ready. Tooling
supplies `VITE_MDBASE_ENV` and `VITE_MDBASE_WRITER_BUILD_ID`; there is no implicit
production endpoint.

The existing deployment contract identifies the exact candidate origins:
`https://staging.mdbase-writer.pages.dev` (staging) and
`https://writer.mdbase.dev` (production). These are a configuration proposal, not
an assertion that CORS/widget-host approval or configuration has happened.
No production widget, secret, package publication or deployment is introduced
by this source PR.

## Sample-data acceptance

Build with demo mode and a loopback feedback URL, serve on loopback port 8892,
then run `node apps/writer/scripts/feedback-browser-test.mjs`. Override the
loopback origin using `WRITER_FEEDBACK_TEST_ORIGIN`. The test uses demo data and
intercepts every feedback POST: desktop/mobile focus, draft restoration, F8 and
command isolation, consent, bounded compiler-failure diagnostics and product/view
metadata. It never sends mail. Real chooser and platform delivery acceptance
remain separate.
