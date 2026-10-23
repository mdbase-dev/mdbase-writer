# Writer interface translations

Writer uses Lingui 6.9 macros, generated English/context IDs, PO source catalogues and compiled ICU JSON. Interface language is independent of a manuscript's `lang`: citation terms, hyphenation, manuscript text, exported prose, source metadata, record paths and user-created labels are not translated.

## Runtime

`apps/writer/src/i18n/app.ts` owns the single Lingui instance. English JSON is synchronous. French, German, Spanish, Japanese, Korean, Brazilian Portuguese (`pt`) and Simplified Chinese (`zh`) are lazy JSON chunks served by the same deployment. Browser language negotiation is used until an explicit choice is saved in `mdbase-writer:interface-locale`. Unavailable browser storage does not block selection. A failed chunk request keeps the current language and saved choice.

The root provider covers dialogs and portals. The editor's separately mounted selection toolbar uses the same instance. Language changes reconfigure CodeMirror's phrases and editor chrome in place rather than recreating the editor or changing its text/history. The runtime updates `<html lang>`; display-only dates, numbers and relative times use the interface locale.

Macros resolve `@writer/i18n` through `runtimeConfigModule`, matching the Vite/Vitest alias and TypeScript path. This is necessary because the shared kit creates a dedicated Lingui instance, rather than using `@lingui/core`'s default singleton.

## Authoring

From `apps/writer`:

```sh
pnpm exec lingui extract
# Author/review src/i18n/locales/<locale>/messages.po locally.
pnpm exec lingui compile --strict --workers 1
```

Use `Trans` for complete sentences with rich markup and ICU plurals for counts. Use `t` in presentation helpers and accessible labels. Add semantic context to ambiguous short messages. Module-level option labels must be lazy getters or rendered on demand, never translations captured before locale selection. Stable command IDs, keyboard bindings, format keys and record values remain untranslated.

The shared collection components receive a translated `CollectionCopy` dictionary. Its `{app}`, `{collection}`, `{account}`, `{id}` and `{query}` substitution tokens are preserved for the shared component's final substitution; values remain user data. The protected `{#fig-plan}` example is Markdown syntax, not translatable prose.

## Current integration status

This branch is in progress, not a nine-language release. The first scope includes Writer-owned screens, editor controls, accessible names, save/recovery/export notices, shared collection UI copy and language controls. Target PO entries are deliberately empty until authored by the assigned local language agents; compiled fallbacks are not evidence of target completeness.

Pending integration gates include vendoring the shared `@mdbase-dev/i18n` tarball and replacing the provisional Lingui config/commands with the kit preset and strict completeness/contracts/source checks. Shared UI feedback/theme/palette internals need the shared UI lane's translation API. Compiler diagnostic prose in the core/worker and authority diagnostics still require a scoped review; exported document content must not enter the interface catalogue.

The final gate is the repository's full check suite, production and editing-test builds, plus browser checks in English, a non-Latin locale and German. None of those checks is implied by successful extraction or catalogue compilation. CI only validates committed catalogues; it must never call a translation provider. The vendored kit dependency must be replaced with its published package version at merge time.
