// A modal dialog: Escape, the close button or a click on the backdrop closes it.
import { useLayoutEffect, useRef, type ReactNode } from "react";

import { CloseIcon } from "./icons.js";

export function Dialog({ open, onClose, title, className, children }: { open: boolean; onClose(): void; title: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  // A layout effect, so the dialog is open before fields ask to be focused.
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={["dialog", className].filter(Boolean).join(" ")}
      aria-label={title}
      onClose={onClose}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="dialog-body">
          <header className="dialog-header">
            <h2>{title}</h2>
            <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
              <CloseIcon />
            </button>
          </header>
          {children}
        </div>
      )}
    </dialog>
  );
}
