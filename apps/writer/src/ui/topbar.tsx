// One bar across the top: the wordmark, whatever the current view puts in the
// slot (an open manuscript's title, status and actions), and the theme.
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { MoonIcon, SunIcon, SystemIcon } from "./icons.js";
import type { ThemePreference } from "@mdbase-dev/ui/theme";

export const TopbarSlot = createContext<HTMLElement | null>(null);

/** Renders children into the top bar. */
export function InTopbar({ children }: { children: ReactNode }) {
  const slot = useContext(TopbarSlot);
  return slot ? createPortal(children, slot) : null;
}

const NEXT: Record<ThemePreference, ThemePreference> = { system: "light", light: "dark", dark: "system" };
const NAME: Record<ThemePreference, string> = { system: "System", light: "Light", dark: "Dark" };

export function ThemeButton({ theme, onChange }: { theme: ThemePreference; onChange(theme: ThemePreference): void }) {
  const Icon = theme === "light" ? SunIcon : theme === "dark" ? MoonIcon : SystemIcon;
  return (
    <button type="button" className="icon-button" onClick={() => onChange(NEXT[theme])} aria-label={`Theme: ${NAME[theme]}. Switch to ${NAME[NEXT[theme]]}`} title={`Theme: ${NAME[theme]} (click for ${NAME[NEXT[theme]]})`}>
      <Icon />
    </button>
  );
}
