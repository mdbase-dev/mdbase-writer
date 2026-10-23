# Writer interface translations

Writer uses Lingui 6.9 macros, generated English/context IDs, PO source catalogues and compiled ICU JSON. Interface language is independent of a manuscript's `lang`: citation terms, hyphenation, manuscript text, exported prose, source metadata, record paths and user-created labels are not translated.

## Runtime

`apps/writer/src/i18n/app.ts` injects the single Lingui instance exported by the shared UI package. English JSON is synchronous. French, German, Spanish, Japanese, Korean, Brazilian Portuguese (`pt`) and Simplified Chinese (`zh`) are lazy JSON chunks served by the same deployment. Browser language negotiation is used until an explicit choice is saved in `mdbase-writer:interface-locale`. Unavailable browser storage does not block selection. A failed chunk request keeps the current language and saved choice.

The language picker is available on the home/sign-in chrome and in workspace settings, so it does not compete with the manuscript toolbar on narrow screens. The root provider covers dialogs and portals. The editor's separately mounted selection toolbar uses the same instance. Language changes reconfigure CodeMirror's phrases and editor chrome in place rather than recreating the editor or changing its text/history. The runtime updates `<html lang>`; display-only dates, numbers and relative times use the interface locale.

The shared runtime is given `i18n` from `@mdbase-dev/ui/i18n` (the same core singleton), so core macros, React context and presentation helpers share one translator without custom module aliases. English is initialized before non-React helpers run; tests load that same real runtime.

## Authoring

From `apps/writer`:

```sh
pnpm i18n:extract
# Author/review src/i18n/locales/<locale>/messages.po locally.
pnpm i18n:compile
pnpm i18n:check
```

`i18n-policy.json` explicitly allowlists reviewed unchanged keyboard key legends, `ID`, Word/DOCX, Spanish/Portuguese Editor/Zoom, Portuguese Layout / “via mdbase Connect”, and reviewed French cognates (e.g. Collection, Source, Citation, Note, Page, Article) / “via mdbase Connect”. It does not exempt whole catalogues or English prose. New identical terms need review; for example, English “click” in a Chinese shortcut hint is not accepted as a keyboard key name.

Use `Trans` for complete sentences with rich markup and ICU plurals for counts. Use `t` in presentation helpers and accessible labels. Add semantic context to ambiguous short messages. Module-level option labels must be lazy getters or rendered on demand, never translations captured before locale selection. Stable command IDs, keyboard bindings, format keys and record values remain untranslated.

Shared UI owns its catalogues. The runtime composes `uiCatalogues` from `@mdbase-dev/ui/i18n` via `libraries`; no library source or provisional collection-copy dictionary is extracted into Writer. App and library target chunks load together before activation. Collection names remain user data, as does the protected `{#fig-plan}` Markdown example. The vendored UI integration snapshot is `vendor/mdbase-dev-ui-0.1.0-beta.141-9041442d.tgz` (SHA-256 `65b7ab3754fe840e04c0128e00f4b9f81dbbf999e0eb987acf97ee72c6b3b55b`). Its shared German/Russian catalogues and later shared deltas are not translation-complete; it must be refreshed before release. Strict runtime composition correctly rejects mismatched compiled entries: an untranslated app/shared catalogue must not silently override an authored one. The current incomplete snapshot blocks German/Russian activation; the empty app Japanese catalogue blocks Japanese activation. Never bypass the collision guard to make an integration test pass.

## Current integration status

This branch is in progress, not a nine-language release. English has 658 active messages after removing 66 provisional shared messages. French, Spanish, Korean and Simplified Chinese have the full current app catalogue. German, Portuguese and Russian need the 54-message app delta; the Japanese catalogue has not arrived. Missing entries remain empty, not English placeholders. The scope includes Writer-owned screens, editor controls, accessible names, save/recovery/export notices, core-owned interface guidance, shared collection UI copy and language controls. Compiled fallbacks are not evidence of target completeness.

The shared kit is vendored from Connect commit `b4134d71` as `vendor/mdbase-dev-i18n-0.1.0-beta.141-b4134d71.tgz` (SHA-256 `3cc9e231dd0ea2ef3cbb34112689e7ed227111f30d976ce0f94d6cd991520806`). Its config preset, runtime, picker, formatters and lazy CodeMirror phrases are adopted. This kit fixes the old symlink-sensitive CLI entry guard: scripts use the bare `mdbase-i18n` command, and the temporary launcher has been deleted. A smoke test requires invalid commands to fail. Strict completeness/contracts/source checks run in normal check/build/CI; CI also rejects drift in committed generated JSON. Until translations arrive these gates intentionally fail rather than accepting English fallback. Shared UI feedback/theme/palette/collection internals use the shared library's own CatalogueSource; no app-local copy dictionary remains. Writer-owned core diagnostics carry serializable copy codes across the worker boundary and are translated in the main-thread presentation adapter. Core/CLI English remains unchanged. Export warning formatting is separate from manuscript materialization; Pandoc warnings are also translated on the main thread, not inside its compiler worker. Raw authority/Typst diagnostics and exported document content never enter the interface catalogue.

The demo-only `apps/writer/scripts/i18n-browser-test.mjs` blocks non-local requests and covers synchronous English, Japanese CodeMirror, language persistence, unchanged manuscript source, the narrow settings picker and a failed locale-chunk request. Its full German/Japanese scenario is blocked by incomplete composed catalogues. A fresh-cache local Playwright check verified actual composed French/Spanish/Chinese activation, Chinese CodeMirror, Chinese 390px settings, preserved manuscript text and retention of the current Chinese choice when incomplete German composition fails. Older pre-adoption browser checks do not certify shared composition; force-restart Vite after changing vendored packages to avoid stale prebundles.

The final gate is the repository's full check suite, production and editing-test builds, plus browser checks in English, a non-Latin locale and German. None of those checks is implied by successful extraction or catalogue compilation. CI only validates committed catalogues; it must never call a translation provider. The vendored kit dependency must be replaced with its published package version at merge time.
