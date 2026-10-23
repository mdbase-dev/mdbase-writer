import { LocaleProvider, LanguagePicker } from "@mdbase-dev/i18n/react";
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
  useLingui();
  const [failed, setFailed] = useState(false);
  return <span className="interface-language">
    <LanguagePicker className="mdbase-field" label={t`Interface language`} onError={() => setFailed(true)} onFocus={() => setFailed(false)} />
    {failed && <span role="alert" className="interface-language-error">{t`The language could not be loaded. Your current language is unchanged. Try again.`}</span>}
  </span>;
}
