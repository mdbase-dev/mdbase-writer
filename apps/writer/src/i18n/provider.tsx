import { LocaleProvider, useI18nRuntime } from "@mdbase-dev/i18n/react";
import { locales, localeNames, isLocale } from "@mdbase-dev/i18n";
import { Select } from "@mdbase-dev/ui/select";
import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useState, type ReactNode } from "react";
import { runtime } from "./app.js";

// Locale failures leave English/current language usable, with an explicit retry via the picker.
const reportStartupFailure = (error: unknown) => console.warn("Interface locale could not be loaded", error);
export function AppI18nProvider({ children }: { children: ReactNode }) {
  return <LocaleProvider runtime={runtime} onError={reportStartupFailure}>{children}</LocaleProvider>;
}
export function InterfaceLanguage() {
  const { i18n } = useLingui();
  const localeRuntime = useI18nRuntime();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  return <span className="interface-language">
    <Select aria-label={t`Interface language`} value={i18n.locale} disabled={busy} options={locales.map(locale => ({ value: locale, label: localeNames[locale] }))} onChange={locale => {
      if (!isLocale(locale)) throw new Error("Language Select returned an unknown locale.");
      setFailed(false);
      setBusy(true);
      void localeRuntime.selectLocale(locale).catch(() => setFailed(true)).finally(() => setBusy(false));
    }} />
    {failed && <span role="alert" className="interface-language-error">{t`The language could not be loaded. Your current language is unchanged. Try again.`}</span>}
  </span>;
}
