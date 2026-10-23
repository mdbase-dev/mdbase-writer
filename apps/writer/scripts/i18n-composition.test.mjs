import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { uiCatalogues } from "@mdbase-dev/ui/i18n";

const load = async locale => JSON.parse(await readFile(new URL(`../src/i18n/locales/${locale}/messages.json`, import.meta.url), "utf8"));
const english = await load("en");

for (const locale of ["en", "de", "es", "fr", "ja", "ko", "pt", "ru", "zh"]) {
  test(`Writer and shared UI agree on every overlapping ${locale} message`, async () => {
    const app = locale === "en" ? english : await load(locale);
    const library = locale === "en" ? uiCatalogues.english : await uiCatalogues.loadLocale(locale);
    const conflicts = [];
    for (const [id, translation] of Object.entries(app.messages)) {
      if (Object.hasOwn(library.messages, id) && JSON.stringify(translation) !== JSON.stringify(library.messages[id])) {
        conflicts.push({ id, english: english.messages[id], writer: translation, shared: library.messages[id] });
      }
    }
    assert.deepEqual(conflicts, [], `Different app/library translations in ${locale}: ${JSON.stringify(conflicts)}`);
  });
}
