// One bar across the top: the wordmark, whatever the current view puts in the
// slot (an open manuscript's title, status and actions), and the theme.
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";


export const TopbarSlot = createContext<HTMLElement | null>(null);

/** Renders children into the top bar. */
export function InTopbar({ children }: { children: ReactNode }) {
  const slot = useContext(TopbarSlot);
  return slot ? createPortal(children, slot) : null;
}
