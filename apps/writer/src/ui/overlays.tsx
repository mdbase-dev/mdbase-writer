import { CommandPalette as SharedCommandPalette } from "@mdbase-dev/ui/command-palette";
import { Dialog as SharedDialog } from "@mdbase-dev/ui/dialog";
import { moveMenuFocus, useMenuPopover } from "@mdbase-dev/ui/popover";
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";

export function useOverlay(open: boolean, selector: string, offset: string) {
  const host = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);

  useLayoutEffect(() => {
    if (!present) return;
    const element = host.current?.querySelector<HTMLElement>(selector);
    if (!element) return;
    element.inert = !open;
    element.ariaHidden = open ? null : "true";
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let active = true;
    const finish = () => {
      animation.current?.cancel();
      animation.current = null;
      if (!open) setPresent(false);
    };
    const changed = () => { if (reduced.matches) finish(); };
    if (reduced.matches) finish();
    else {
      const style = getComputedStyle(element);
      const from = animation.current
        ? { opacity: style.opacity, transform: style.transform }
        : { opacity: open ? "0" : "1", transform: open ? offset : "none" };
      animation.current?.cancel();
      const next = element.animate([from, { opacity: open ? "1" : "0", transform: open ? "none" : offset }], {
        duration: open ? 160 : 120,
        easing: "cubic-bezier(.22,1,.36,1)",
        fill: "both",
      });
      animation.current = next;
      void next.finished.then(() => { if (active) finish(); }, () => {});
    }
    reduced.addEventListener("change", changed);
    return () => { active = false; reduced.removeEventListener("change", changed); };
  }, [open, present, selector, offset]);

  useLayoutEffect(() => () => { animation.current?.cancel(); animation.current = null; }, []);
  return { host, present: open || present };
}

export function Dialog(props: ComponentProps<typeof SharedDialog>) {
  const { host, present } = useOverlay(props.open, ".mdbase-dialog", "translateY(-3px)");
  return <div ref={host} className="overlay-host"><SharedDialog {...props} open={present} /></div>;
}

export function CommandPalette(props: ComponentProps<typeof SharedCommandPalette>) {
  const { host, present } = useOverlay(props.open, ".mdbase-command-backdrop", "translateY(-3px)");
  return <div ref={host} className="overlay-host"><SharedCommandPalette {...props} open={present} /></div>;
}

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

export function Popover({ open, ...props }: PopoverProps) {
  const { host, present } = useOverlay(open, ".popover", "translateY(-3px)");
  return <div ref={host} className="overlay-host">{present && <OpenPopover {...props} />}</div>;
}

function OpenPopover({ id, trigger, width, label, align = "start", focus, onClose, children }: Omit<PopoverProps, "open">) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuPopover(ref, trigger, onClose, { width, align, focus });
  return <div ref={ref} id={id} className="mdbase-menu popover" popover="manual" role="menu" aria-label={label} tabIndex={-1} onKeyDown={(event) => moveMenuFocus(event, ref.current)}>{children}</div>;
}
