// One bar across the top: the wordmark, whatever the current view puts in the
// slot (an open manuscript's title, status and actions), and the theme.
import type { ThemePreference } from "@mdbase-dev/ui/theme";
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const TopbarSlot = createContext<HTMLElement | null>(null);

/** Renders children into the top bar. */
export function InTopbar({ children }: { children: ReactNode }) {
  const slot = useContext(TopbarSlot);
  return slot ? createPortal(children, slot) : null;
}

/** The theme choice, which the bar shows on its own outside a manuscript and in the manuscript's menu inside one. */
export const ThemeChoice = createContext<{ readonly theme: ThemePreference; setTheme(theme: ThemePreference): void } | null>(null);
