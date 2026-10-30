import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { AppSwitcher } from "./ui/AppSwitcher.js";
import { FeedbackButton, useFeedback } from "@mdbase-dev/ui/feedback";
import { WriterErrorBoundary } from "./ui/WriterErrorBoundary.js";
import { loadThemePreference, saveThemePreference, type ThemePreference } from "@mdbase-dev/ui/theme";
import { ThemeSelect } from "@mdbase-dev/ui/theme-select";
import { InterfaceLanguage } from "./i18n/provider.js";
import { OpeningScreen } from "@mdbase-dev/ui/screens";
import { ThemeChoice, TopbarSlot } from "./ui/topbar.js";
import { SdkWriterRoot, type SdkWriterRootProps } from "./ui/SdkWriterRoot.js";

import { writerDemoRequested } from "./demo-mode.js";

const DemoRoot = lazy(async () => ({ default: (await import("./ui/DemoRoot.js")).DemoRoot }));
export function App(props: Partial<SdkWriterRootProps> = {}) {
  useLingui();
  const {reportError} = useFeedback();
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => saveThemePreference(theme), [theme]);
  const themeChoice = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeChoice.Provider value={themeChoice}><TopbarSlot.Provider value={slot}>
    <div className="app"><header className="topbar">
      <AppSwitcher /><div className="topbar-slot" ref={setSlot} />
      <InterfaceLanguage />
      <ThemeSelect className="topbar-theme" value={theme} onChange={setTheme} /><FeedbackButton />
    </header><WriterErrorBoundary onError={() => reportError({code: "unknown_error"})}>{props.sdk ? <SdkWriterRoot {...props} sdk={props.sdk} /> : writerDemoRequested() ?
      <Suspense fallback={<OpeningScreen app="writer" title={t`Opening mdbase writer`} />}><DemoRoot /></Suspense> : null}</WriterErrorBoundary></div>
  </TopbarSlot.Provider></ThemeChoice.Provider>;
}
