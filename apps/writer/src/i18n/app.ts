import { createI18nRuntime } from "@mdbase-dev/i18n";
import { i18n, uiCatalogues } from "@mdbase-dev/ui/i18n";
import english from "./locales/en/messages.json";

const chunks = {
  fr: () => import("./locales/fr/messages.json"),
  de: () => import("./locales/de/messages.json"),
  es: () => import("./locales/es/messages.json"),
  it: () => import("./locales/it/messages.json"),
  ja: () => import("./locales/ja/messages.json"),
  ko: () => import("./locales/ko/messages.json"),
  pt: () => import("./locales/pt/messages.json"),
  ru: () => import("./locales/ru/messages.json"),
  zh: () => import("./locales/zh/messages.json"),
};
const storageKey = "mdbase-writer:interface-locale";
export const runtime = createI18nRuntime({
  i18n,
  english,
  libraries: [uiCatalogues],
  loadLocale: async (locale) => (await chunks[locale]()).default,
  storage: {
    getLocale() {
      try { return globalThis.localStorage?.getItem(storageKey) ?? null; }
      catch { return null; }
    },
    setLocale(locale) {
      try { globalThis.localStorage?.setItem(storageKey, locale); }
      catch { /* A blocked browser store must not stop language selection. */ }
    },
  },
});
export { i18n };
