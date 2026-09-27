// The mdbase Frontmatter mark (geometry from mdbase-connect/assets), inverted
// per app: the bars take the app's colour and the highlighted line stays ink.
// The wordmark opens a menu for opening this collection in the other apps.
import { useId, useRef, useState, type RefObject } from "react";

import { mdbaseAppHref, mdbaseApps, type MdbaseApp, type MdbaseAppId } from "./apps.js";
import { moveMenuFocus, usePopover } from "./popover.js";

const inkRects = [
  { x: 22, y: 22, width: 20, height: 10 },
  { x: 50, y: 22, width: 20, height: 10 },
  { x: 78, y: 22, width: 20, height: 10 },
  { x: 22, y: 44, width: 12, height: 10 },
  { x: 22, y: 66, width: 28, height: 10 },
  { x: 58, y: 66, width: 40, height: 10 },
  { x: 22, y: 88, width: 20, height: 10 },
  { x: 50, y: 88, width: 20, height: 10 },
  { x: 78, y: 88, width: 20, height: 10 },
] as const;

export function AppMark({ app, className }: { app: MdbaseAppId; className?: string }) {
  return (
    <svg viewBox="18 18 84 84" aria-hidden="true" className={["app-mark", `is-${app}`, className].filter(Boolean).join(" ")}>
      <g className="app-mark-bars">
        {inkRects.map((r) => (
          <rect key={`${r.x}-${r.y}`} {...r} rx="2" />
        ))}
      </g>
      <rect className="app-mark-line" x="42" y="44" width="56" height="10" rx="2" />
    </svg>
  );
}

// Local builds point the menu at local copies of the other apps.
const appUrlOverrides: Partial<Record<MdbaseAppId, string | undefined>> = {
  editor: import.meta.env.VITE_MDBASE_EDITOR_URL,
  reader: import.meta.env.VITE_MDBASE_READER_URL,
  writer: import.meta.env.VITE_MDBASE_WRITER_URL,
};

export function Wordmark() {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="wordmark app-switcher"
        aria-label="mdbase writer: open this collection in another app"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Open in another mdbase app"
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <AppMark app="writer" className="mark" />
        <strong>mdbase</strong>
        <span>writer</span>
        <svg className="app-switcher-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>
      {open ? <AppMenu id={menuId} triggerRef={triggerRef} onClose={close} /> : null}
    </>
  );
}

function AppMenu({ id, triggerRef, onClose }: { id: string; triggerRef: RefObject<HTMLButtonElement | null>; onClose: (refocus: boolean) => void }) {
  const menuRef = useRef<HTMLDivElement>(null);
  usePopover(menuRef, triggerRef, onClose, { width: 320, focus: 'a[role="menuitem"]' });
  const heading = new URL(location.href).searchParams.has("collection") ? "Open this collection in" : "mdbase apps";
  return (
    <div ref={menuRef} id={id} className="app-menu" popover="manual" role="menu" aria-label={heading} tabIndex={-1} onKeyDown={(e) => moveMenuFocus(e, menuRef.current)}>
      <div className="app-menu-heading" role="presentation">{heading}</div>
      {mdbaseApps.map((app) => (
        <AppItem key={app.id} app={app} onOpen={() => onClose(false)} />
      ))}
      <p className="app-menu-note">Opens in a new tab</p>
    </div>
  );
}

function AppItem({ app, onOpen }: { app: MdbaseApp; onOpen: () => void }) {
  const copy = (
    <>
      <AppMark app={app.id} className="app-menu-mark" />
      <span className="app-menu-copy">
        <strong>{app.name}</strong>
        <small>{app.description}</small>
      </span>
    </>
  );
  if (app.id === "writer") {
    return (
      <div className="app-menu-item is-current" role="menuitem" aria-current="page" aria-disabled="true" tabIndex={-1}>
        {copy}
        <span className="app-menu-current">Current</span>
      </div>
    );
  }
  return (
    <a className="app-menu-item" role="menuitem" href={mdbaseAppHref(appUrlOverrides[app.id] ?? app.url, location.href)} target="_blank" rel="noopener" onClick={onOpen}>
      {copy}
      <svg className="app-menu-external" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M10 5.5H5.5v13h13V14M13.5 5.5h5v5M18.5 5.5 11 13" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
      <span className="visually-hidden"> (opens in a new tab)</span>
    </a>
  );
}
