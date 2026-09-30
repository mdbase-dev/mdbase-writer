// The collection a manuscript list comes from, and switching it: a menu
// dropped from the collection's name, as in mdbase Reader. The current
// collection comes first, then the others alphabetically; a filter appears
// once there are enough to need one.
import type { MdbaseConnectionInfo } from "@mdbase-dev/connect";
import { moveMenuFocus, useMenuPopover } from "@mdbase-dev/ui/popover";
import { useId, useRef, useState } from "react";

import type { WriterSession } from "../connect/session.js";
import { CheckIcon, ChevronDown, PlusIcon } from "./icons.js";

/** Collections worth a filter; fewer fit at a glance. */
const FILTER_FROM = 7;

type Choice = Pick<MdbaseConnectionInfo, "collectionId" | "displayName"> & { readonly authority?: { readonly kind: "hosted" | "connector" } };

/** Where a collection lives, in Reader's words. */
function place(choice: Choice): string | null {
  return choice.authority?.kind === "hosted" ? "Hosted by mdbase" : choice.authority?.kind === "connector" ? "On your computer" : null;
}

/** Only shown on Home, where there is no open manuscript to save before switching. */
export function CollectionPicker({ name, collectionId, connections, session }: {
  name: string;
  collectionId: string;
  connections: readonly MdbaseConnectionInfo[];
  session: Pick<WriterSession, "select" | "authorize">;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const close = (refocus: boolean) => {
    setOpen(false);
    setProblem(null);
    if (refocus) trigger.current?.focus();
  };
  const choose = (id: string) => {
    if (id === collectionId) {
      close(true);
      return;
    }
    setProblem(null);
    try {
      const result = session.select(id);
      if (result.ok) close(false);
      else setProblem(result.problem.message);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not switch collections.");
    }
  };
  const connect = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await session.authorize("choose", { presentation: "popup", timeoutMs: 10 * 60_000 });
      if (result.ok) close(false);
      else setProblem(result.problem.message);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Could not connect another collection.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="collection-picker-trigger"
        aria-label={`Switch collection: ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title="Switch collection"
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <strong>{name}</strong>
        <ChevronDown className="collection-picker-chevron" />
      </button>
      {open && (
        <CollectionMenu
          id={menuId}
          trigger={trigger}
          current={{ ...connections.find((c) => c.collectionId === collectionId), collectionId, displayName: name }}
          others={connections.filter((c) => c.collectionId !== collectionId)}
          busy={busy}
          problem={problem}
          onChoose={choose}
          onConnect={() => void connect()}
          onClose={close}
        />
      )}
    </>
  );
}

function CollectionMenu({ id, trigger, current, others, busy, problem, onChoose, onConnect, onClose }: {
  id: string;
  trigger: React.RefObject<HTMLButtonElement | null>;
  /** Under its freshest name, which the cached connection list may not have yet. */
  current: Choice;
  others: readonly Choice[];
  busy: boolean;
  problem: string | null;
  onChoose(id: string): void;
  onConnect(): void;
  onClose(refocus: boolean): void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  useMenuPopover(menu, trigger, onClose, { width: 300, busy, focus: '[role="menuitemradio"][aria-checked="true"]' });
  const all = [current, ...[...others].sort((a, b) => a.displayName.localeCompare(b.displayName))];
  const words = query.trim().toLocaleLowerCase();
  const shown = words ? all.filter((c) => c.displayName.toLocaleLowerCase().includes(words)) : all;
  return (
    <div ref={menu} id={id} className="mdbase-menu collection-menu" popover="manual" role="menu" aria-label="Switch collection" tabIndex={-1} onKeyDown={(e) => moveMenuFocus(e, menu.current)}>
      <span className="menu-label" aria-hidden="true">Collections</span>
      {all.length >= FILTER_FROM && (
        <input className="mdbase-field collection-menu-filter" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter collections" aria-label="Filter collections" />
      )}
      <div role="group" aria-label="Connected collections">
        {shown.map((c) => {
          const here = c.collectionId === current.collectionId;
          const detail = [here ? "Open now" : null, place(c)].filter(Boolean).join(" · ");
          return (
            <button key={c.collectionId} type="button" role="menuitemradio" aria-checked={here} className="menu-item collection-menu-item" disabled={busy} onClick={() => onChoose(c.collectionId)}>
              <span className="collection-menu-copy">
                <strong>{c.displayName}</strong>
                {detail && <small>{detail}</small>}
              </span>
              {here && <CheckIcon className="collection-menu-check" />}
            </button>
          );
        })}
        {!shown.length && <p className="collection-menu-note muted">No collection matches “{query.trim()}”.</p>}
      </div>
      {problem && <p className="collection-menu-note problem" role="alert">{problem}</p>}
      <div className="menu-group">
        <button type="button" role="menuitem" className="menu-item collection-menu-connect" disabled={busy} onClick={onConnect}>
          <PlusIcon />
          <span>{busy ? "Waiting for mdbase connect…" : "Connect another collection…"}</span>
        </button>
      </div>
    </div>
  );
}
