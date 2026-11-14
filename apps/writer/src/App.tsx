import { useLingui } from "@lingui/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AppSwitcher } from "./ui/AppSwitcher.js";
import { FeedbackButton } from "@mdbase-dev/ui/feedback";
import { loadThemePreference, saveThemePreference, type ThemePreference } from "@mdbase-dev/ui/theme";
import { ThemeSelect } from "@mdbase-dev/ui/theme-select";
import { ThemeChoice, TopbarSlot } from "./ui/topbar.js";
import { SdkWriterRoot, type SdkWriterRootProps } from "./ui/SdkWriterRoot.js";

export function App(props: SdkWriterRootProps) {
  return <WriterShell><SdkWriterRoot {...props} /></WriterShell>;
}
export function WriterShell({ children }: { children: ReactNode }) {
  useLingui();
  const [theme, setTheme] = useState<ThemePreference>(() => loadThemePreference());
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => saveThemePreference(theme), [theme]);
  const themeChoice = useMemo(() => ({ theme, setTheme }), [theme]);
  return <ThemeChoice.Provider value={themeChoice}><TopbarSlot.Provider value={slot}>
    <div className="app"><header className="topbar">
      <AppSwitcher /><div className="topbar-slot" ref={setSlot} />
      <ThemeSelect className="topbar-theme" value={theme} onChange={setTheme} /><FeedbackButton />
    </header>{children}</div>
  </TopbarSlot.Provider></ThemeChoice.Provider>;
}
