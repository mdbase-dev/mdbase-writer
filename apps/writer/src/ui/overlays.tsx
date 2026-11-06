import { CommandPalette as SharedCommandPalette } from "@mdbase-dev/ui/command-palette";
import { Dialog as SharedDialog } from "@mdbase-dev/ui/dialog";
import { moveMenuFocus, useMenuPopover } from "@mdbase-dev/ui/popover";
import { useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";

export function useOverlay(open: boolean, selector: string, offset: string) {
  const host = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  const backdrop = useRef<Animation | null>(null);
  const [present, setPresent] = useState(open);
  if (open && !present) setPresent(true);

  useLayoutEffect(() => {
    if (!present) { animation.current?.cancel(); animation.current = null; backdrop.current?.cancel(); backdrop.current = null; return; }
    const element = host.current?.querySelector<HTMLElement>(selector);
    if (!element) return;
    element.inert = !open;
    element.ariaHidden = open ? null : "true";
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let active = true;
    const finish = () => {
      if (!open) setPresent(false);
      else if (reduced.matches) { animation.current?.cancel(); animation.current = null; backdrop.current?.cancel(); backdrop.current = null; }
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
        easing: open ? "cubic-bezier(.22,1,.36,1)" : "cubic-bezier(.4,0,1,1)",
        fill: "both",
      });
      animation.current = next;
      if (element.matches(".mdbase-dialog")) {
        const opacity = backdrop.current ? getComputedStyle(element, "::backdrop").opacity : open ? "0" : "1";
        backdrop.current?.cancel();
        backdrop.current = element.animate([{ opacity }, { opacity: open ? "1" : "0" }], {
          duration: open ? 160 : 120, easing: open ? "cubic-bezier(.22,1,.36,1)" : "cubic-bezier(.4,0,1,1)", fill: "both", pseudoElement: "::backdrop",
        });
      }
      void next.finished.then(() => { if (active) finish(); }, () => {});
    }
    reduced.addEventListener("change", changed);
    return () => { active = false; reduced.removeEventListener("change", changed); };
  }, [open, present, selector, offset]);

  useLayoutEffect(() => () => { animation.current?.cancel(); animation.current = null; backdrop.current?.cancel(); backdrop.current = null; }, []);
  return { host, present: open || present };
}

export function Dialog(props: ComponentProps<typeof SharedDialog>) {
  const { host, present } = useOverlay(props.open, ".mdbase-dialog", "translateY(-3px)");
  return <div ref={host} className="overlay-host"><SharedDialog {...props} present={present} /></div>;
}

export function CommandPalette(props: ComponentProps<typeof SharedCommandPalette>) {
  const { host, present } = useOverlay(props.open, ".mdbase-command-backdrop", "none");
  return <div ref={host} className="overlay-host"><SharedCommandPalette {...props} present={present} /></div>;
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
  return <div ref={host} className="overlay-host">{present && <OpenPopover {...props} open={open} />}</div>;
}

function OpenPopover({ open, id, trigger, width, label, align = "start", focus, onClose, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuPopover(ref, trigger, onClose, { width, align, focus, busy: !open });
  return <div ref={ref} id={id} className="mdbase-menu popover" popover="manual" role="menu" aria-label={label} tabIndex={-1} onKeyDown={(event) => moveMenuFocus(event, ref.current)}>{children}</div>;
}
