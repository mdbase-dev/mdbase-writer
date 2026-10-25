import { I18n, type MessageDescriptor, type MessageOptions } from "@lingui/core";
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

// Lingui 6.9 decodes JS escapes after interpolation, including user text such as
// paths, titles and LaTeX. Encode backslashes for that single decoding pass;
// input values are never changed.
const renderMessage = I18n.prototype._.bind(i18n);
i18n._ = (id: string | MessageDescriptor, values?: Record<string, unknown>, options?: MessageOptions) => {
  if (typeof id === "string") return renderMessage(id, literalValues(values), options);
  const literal = literalValues(id.values || values);
  return renderMessage(literal ? { ...id, values: literal } : id);
};
i18n.t = i18n._.bind(i18n);

function literalValues(values?: Record<string, unknown>) {
  return values && Object.fromEntries(Object.entries(values).map(([key, value]) =>
    [key, typeof value === "string" ? value.replace(/\\/g, "\\u005c") : value]));
}
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
