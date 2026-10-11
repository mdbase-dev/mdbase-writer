import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AppSwitcher } from "@mdbase-dev/ui/app-switcher";
import { FeedbackButton } from "@mdbase-dev/ui/feedback";
import { loadThemePreference, saveThemePreference, type ThemePreference } from "@mdbase-dev/ui/theme";
import { ThemeSelect } from "@mdbase-dev/ui/theme-select";
import { OpeningScreen } from "@mdbase-dev/ui/screens";
import { appUrls } from "./apps.js";
import { ThemeChoice, TopbarSlot } from "./ui/topbar.js";
import { SdkWriterRoot, type SdkWriterRootProps } from "./ui/SdkWriterRoot.js";

// Native mode never imports the legacy session/collection URL module.
// Production keeps its existing default; switching/bootstrap belongs to owner GO.
const LegacyApp = lazy(async () => ({ default: (await import("./LegacyApp.js")).LegacyApp }));
export function App(props: Partial<SdkWriterRootProps> = {}) {
  return props.sdk ? <NativeApp {...props} sdk={props.sdk} /> :
    <Suspense fallback={<OpeningScreen app="writer" title="Opening mdbase writer" />}><LegacyApp /></Suspense>;
}
function NativeApp(props: SdkWriterRootProps) {
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => saveThemePreference(theme), [theme]);
  const themeChoice = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeChoice.Provider value={themeChoice}><TopbarSlot.Provider value={slot}>
    <div className="app"><header className="topbar">
      <AppSwitcher current="writer" urls={appUrls} /><div className="topbar-slot" ref={setSlot} />
      <ThemeSelect className="topbar-theme" value={theme} onChange={setTheme} /><FeedbackButton />
    </header><SdkWriterRoot {...props} /></div>
  </TopbarSlot.Provider></ThemeChoice.Provider>;
}
