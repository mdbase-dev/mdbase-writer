import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AppSwitcher } from "./ui/AppSwitcher.js";
import { FeedbackButton } from "@mdbase-dev/ui/feedback";
import { loadThemePreference, saveThemePreference, type ThemePreference } from "@mdbase-dev/ui/theme";
import { ThemeSelect } from "@mdbase-dev/ui/theme-select";
import { InterfaceLanguage } from "./i18n/provider.js";
import { OpeningScreen } from "@mdbase-dev/ui/screens";
import { ThemeChoice, TopbarSlot } from "./ui/topbar.js";
import { SdkWriterRoot, type SdkWriterRootProps } from "./ui/SdkWriterRoot.js";

// Native mode never imports the legacy session/collection URL module.
// Production keeps its existing default; switching/bootstrap belongs to owner GO.
const LegacyApp = lazy(async () => ({ default: (await import("./LegacyApp.js")).LegacyApp }));
export function App(props: Partial<SdkWriterRootProps> = {}) {
  useLingui();
  return props.sdk ? <NativeApp {...props} sdk={props.sdk} /> :
    <Suspense fallback={<OpeningScreen app="writer" title={t`Opening mdbase writer`} />}><LegacyApp /></Suspense>;
}
function NativeApp(props: SdkWriterRootProps) {
  useLingui();
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => saveThemePreference(theme), [theme]);
  const themeChoice = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeChoice.Provider value={themeChoice}><TopbarSlot.Provider value={slot}>
    <div className="app"><header className="topbar">
      <AppSwitcher /><div className="topbar-slot" ref={setSlot} />
      <InterfaceLanguage />
            <ThemeSelect className="topbar-theme" value={theme} onChange={setTheme} /><FeedbackButton />
    </header><SdkWriterRoot {...props} /></div>
  </TopbarSlot.Provider></ThemeChoice.Provider>;
}
