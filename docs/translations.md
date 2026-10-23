# Writer interface translations

Writer uses Lingui 6.9 macros, generated English/context IDs, PO source catalogues and compiled ICU JSON. Interface language is independent of a manuscript's `lang`: citation terms, hyphenation, manuscript text, exported prose, source metadata, record paths and user-created labels are not translated.

## Runtime

`apps/writer/src/i18n/app.ts` owns the single Lingui instance. English JSON is synchronous. French, German, Spanish, Japanese, Korean, Brazilian Portuguese (`pt`) and Simplified Chinese (`zh`) are lazy JSON chunks served by the same deployment. Browser language negotiation is used until an explicit choice is saved in `mdbase-writer:interface-locale`. Unavailable browser storage does not block selection. A failed chunk request keeps the current language and saved choice.

The language picker is available on the home/sign-in chrome and in workspace settings, so it does not compete with the manuscript toolbar on narrow screens. The root provider covers dialogs and portals. The editor's separately mounted selection toolbar uses the same instance. Language changes reconfigure CodeMirror's phrases and editor chrome in place rather than recreating the editor or changing its text/history. The runtime updates `<html lang>`; display-only dates, numbers and relative times use the interface locale.

The shared runtime is given `i18n` from `@lingui/core`, so core macros, React context and presentation helpers share one translator without custom module aliases. English is initialized before non-React helpers run; tests load that same real runtime.

## Authoring

From `apps/writer`:

```sh
pnpm i18n:extract
# Author/review src/i18n/locales/<locale>/messages.po locally.
pnpm i18n:compile
pnpm i18n:check
```

`i18n-policy.json` explicitly allowlists reviewed unchanged keyboard key legends, `ID`, Word/DOCX, Spanish/Portuguese Editor/Zoom, and Portuguese Layout / “via mdbase Connect”. It does not exempt whole catalogues or English prose. New identical terms need review; for example, English “click” in a Chinese shortcut hint is not accepted as a keyboard key name.

Use `Trans` for complete sentences with rich markup and ICU plurals for counts. Use `t` in presentation helpers and accessible labels. Add semantic context to ambiguous short messages. Module-level option labels must be lazy getters or rendered on demand, never translations captured before locale selection. Stable command IDs, keyboard bindings, format keys and record values remain untranslated.

The shared collection components receive a translated `CollectionCopy` dictionary. Its `{app}`, `{collection}`, `{account}`, `{id}` and `{query}` substitution tokens are preserved for the shared component's final substitution; values remain user data. The protected `{#fig-plan}` example is Markdown syntax, not translatable prose.

## Current integration status

This branch is in progress, not a nine-language release. The first scope includes Writer-owned screens, editor controls, accessible names, save/recovery/export notices, shared collection UI copy and language controls. Target PO entries are deliberately empty until authored by the assigned local language agents; compiled fallbacks are not evidence of target completeness.

The shared kit is vendored from Connect commit `096d80bf` as `vendor/mdbase-dev-i18n-0.1.0-beta.141-096d80bf.tgz` (SHA-256 `ba0d9ca37ab265482c8716672995523db9a5f56d15554507bf408b7dcf50e95b`). Its config preset, runtime, picker, formatters and lazy CodeMirror phrases are adopted. This tarball still has a symlink-sensitive CLI entry guard: `pnpm exec mdbase-i18n definitely-not-a-command` silently exits zero. `scripts/i18n.mjs` launches the pinned package's real CLI file, without bypassing any checks; a smoke test requires invalid commands to fail. Remove the launcher when the published kit fixes its entry guard. Strict completeness/contracts/source checks run in normal check/build/CI; CI also rejects drift in committed generated JSON. Until translations arrive these gates intentionally fail rather than accepting English fallback. Shared UI feedback/theme/palette internals will adopt the shared libraries' own catalogue sources, not more app-local copy dictionaries. Writer-owned core diagnostics carry serializable copy codes across the worker boundary and are translated in the main-thread presentation adapter. Core/CLI English remains unchanged. Export warning formatting is separate from manuscript materialization; Pandoc warnings are also translated on the main thread, not inside its compiler worker. Raw authority/Typst diagnostics and exported document content never enter the interface catalogue.

The demo-only `apps/writer/scripts/i18n-browser-test.mjs` blocks non-local requests and covers synchronous English, Japanese CodeMirror, language persistence, unchanged manuscript source, the narrow settings picker and a failed locale-chunk request. Product-catalogue German/Japanese layout acceptance still needs authored translations.

The final gate is the repository's full check suite, production and editing-test builds, plus browser checks in English, a non-Latin locale and German. None of those checks is implied by successful extraction or catalogue compilation. CI only validates committed catalogues; it must never call a translation provider. The vendored kit dependency must be replaced with its published package version at merge time.
