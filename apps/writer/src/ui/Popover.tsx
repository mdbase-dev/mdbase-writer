import { useOverlay } from "@mdbase-dev/ui/overlay";
import { moveMenuFocus, useMenuPopover } from "@mdbase-dev/ui/popover";
import { type ReactNode, type RefObject } from "react";

interface PopoverProps {
  open: boolean;
  id: string;
  trigger: RefObject<HTMLElement | null>;
  width: number;
  label: string;
  align?: "start" | "end";
  focus?: string;
  onClose(refocus: boolean): void;
  children: ReactNode;
}

export function Popover({ open, id, trigger, width, label, align = "start", focus, onClose, children }: PopoverProps) {
  const { ref, present } = useOverlay<HTMLDivElement>(open);
  useMenuPopover(ref, trigger, onClose, { width, align, focus, open });
  return present ? <div ref={ref} id={id} className="mdbase-menu popover mdbase-overlay" data-open={open} inert={!open} aria-hidden={!open || undefined} popover="manual" role="menu" aria-label={label} tabIndex={-1} onKeyDown={event => moveMenuFocus(event, ref.current)}>{children}</div> : null;
}
