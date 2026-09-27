// Menus and popovers anchored to a trigger: placed below it in the top layer,
// closed on an outside pointer, Escape (returning focus to the trigger), Tab
// or a resize. Arrow keys, Home and End move between menu items.
import { useEffect, useLayoutEffect, useRef, type KeyboardEvent, type RefObject } from "react";

export interface PopoverPlacement {
  readonly width: number;
  /** Which edge of the trigger the popover lines up with. */
  readonly align?: "start" | "end";
  /** Element focused when the popover opens. */
  readonly focus?: string;
}

export function usePopover(
  popoverRef: RefObject<HTMLElement | null>,
  triggerRef: RefObject<HTMLElement | null>,
  onClose: (refocus: boolean) => void,
  { width, align = "start", focus = '[role="menuitem"]' }: PopoverPlacement,
) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useLayoutEffect(() => {
    const popover = popoverRef.current;
    const trigger = triggerRef.current;
    if (!popover || !trigger) return undefined;
    if (typeof popover.showPopover === "function") popover.showPopover();
    const box = trigger.getBoundingClientRect();
    const w = Math.min(width, window.innerWidth - 16);
    const left = align === "end" ? box.right - w : box.left;
    popover.style.width = `${w}px`;
    popover.style.top = `${box.bottom + 6}px`;
    popover.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`;
    popover.style.maxHeight = `${Math.max(160, window.innerHeight - box.bottom - 18)}px`;
    (popover.querySelector<HTMLElement>(focus) ?? popover).focus();
    return () => {
      if (typeof popover.hidePopover === "function" && popover.matches(":popover-open")) popover.hidePopover();
    };
  }, [popoverRef, triggerRef, width, align, focus]);
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (target && !popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) closeRef.current(false);
    };
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current(true);
      } else if (e.key === "Tab") {
        closeRef.current(false);
      }
    };
    const onResize = () => closeRef.current(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", onResize);
    };
  }, [popoverRef, triggerRef]);
}

export function moveMenuFocus(e: KeyboardEvent, menu: HTMLElement | null) {
  if (!menu || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
  e.preventDefault();
  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : (current + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
  items[next]?.focus();
}
