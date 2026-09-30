// A toolbar over a selection: inline formatting, then Writer's own actions on
// the passage (cite, comment, suggest an edit). It shows once a selection
// settles — on releasing the mouse, or after a pause in keyboard selection —
// and goes as soon as the text or selection changes, the editor loses focus,
// or Escape is pressed. Touch devices keep their own selection menu instead.
import { EditorSelection, Prec, StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, keymap, showTooltip, ViewPlugin, type Command, type Tooltip, type ViewUpdate } from "@codemirror/view";
import { createRoot } from "react-dom/client";

import { BoldIcon, CodeIcon, ItalicIcon, LinkIcon } from "../ui/icons.js";
import { makeLink, toggleBold, toggleCode, toggleItalic } from "./formatting.js";
import { ALT_LABEL, MOD_LABEL } from "./insight.js";

export type SelectionAction = "cite" | "comment" | "suggest";

/** Keyboard selection shows the bar once it has been still this long. */
const SETTLE_MS = 450;

const setOpen = StateEffect.define<boolean>();

const open = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setOpen)) return e.value;
    return tr.docChanged || tr.selection ? false : value;
  },
});

export function selectionBar(onAction: (action: SelectionAction, view: EditorView) => void): Extension {
  const bar = showTooltip.compute([open], (state): Tooltip | null => {
    const range = state.selection.main;
    if (!state.field(open) || range.empty) return null;
    return {
      pos: range.from,
      above: true,
      create: (view) => {
        const dom = document.createElement("div");
        dom.className = "cm-selection-bar";
        // Pressing a button must not take focus (or the selection) from the editor.
        dom.addEventListener("mousedown", (e) => e.preventDefault());
        const root = createRoot(dom);
        // Formatting keeps the bar up, so a passage can be made bold and then
        // italic; a link does not, as its address is selected to be typed over.
        const format = (command: Command) => {
          command(view);
          if (command !== makeLink && !view.state.selection.main.empty) view.dispatch({ effects: setOpen.of(true) });
        };
        root.render(<Bar readOnly={state.readOnly} run={format} act={(action) => onAction(action, view)} />);
        return { dom, destroy: () => queueMicrotask(() => root.unmount()) };
      },
    };
  });

  const coarse = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  const settle = ViewPlugin.fromClass(
    class {
      timer: ReturnType<typeof setTimeout> | undefined;
      pointer = false;
      readonly release = () => {
        if (!this.pointer) return;
        this.pointer = false;
        requestAnimationFrame(() => this.show());
      };
      constructor(readonly view: EditorView) {
        window.addEventListener("mouseup", this.release);
      }
      show() {
        const { view } = this;
        if (coarse || this.pointer || !view.hasFocus || view.state.selection.main.empty || view.state.field(open)) return;
        view.dispatch({ effects: setOpen.of(true) });
      }
      update(u: ViewUpdate) {
        if (u.focusChanged && !u.view.hasFocus && u.view.state.field(open)) queueMicrotask(() => u.view.dispatch({ effects: setOpen.of(false) }));
        // Only the text and the selection restart the wait; other updates (new
        // problems, comment anchors) arrive while it runs and must not cancel it.
        if (!u.selectionSet && !u.docChanged) return;
        clearTimeout(this.timer);
        if (u.selectionSet && !u.docChanged && !this.pointer && !u.view.state.selection.main.empty) this.timer = setTimeout(() => this.show(), SETTLE_MS);
      }
      destroy() {
        clearTimeout(this.timer);
        window.removeEventListener("mouseup", this.release);
      }
    },
    {
      eventHandlers: {
        mousedown(e) {
          if (e.button === 0) this.pointer = true;
        },
      },
    },
  );

  const dismiss = Prec.high(
    keymap.of([
      {
        key: "Escape",
        run: (view) => {
          if (!view.state.field(open)) return false;
          view.dispatch({ effects: setOpen.of(false) });
          return true;
        },
      },
    ]),
  );

  return [open, bar, settle, dismiss];
}

/** Collapses the selection to its end, so what is inserted next (a citation) follows the passage. */
export function collapseToEnd(view: EditorView): void {
  const end = view.state.selection.main.to;
  view.dispatch({ selection: EditorSelection.cursor(end) });
}

function Bar({ readOnly, run, act }: { readOnly: boolean; run(command: Command): void; act(action: SelectionAction): void }) {
  const format = (label: string, keys: string | null, Icon: typeof BoldIcon, command: Command) => (
    <button type="button" className="cm-selection-button is-icon" aria-label={label} title={keys ? `${label} (${keys})` : label} onClick={() => run(command)}>
      <Icon />
    </button>
  );
  const action = (label: string, title: string, what: SelectionAction) => (
    <button type="button" className="cm-selection-button" title={title} onClick={() => act(what)}>
      {label}
    </button>
  );
  return (
    <div role="toolbar" aria-label="Selection" className="cm-selection-bar-row">
      {!readOnly && (
        <>
          {format("Bold", `${MOD_LABEL}-B`, BoldIcon, toggleBold)}
          {format("Italic", `${MOD_LABEL}-I`, ItalicIcon, toggleItalic)}
          {format("Code", null, CodeIcon, toggleCode)}
          {format("Link", `${MOD_LABEL}-Shift-K`, LinkIcon, makeLink)}
          <span className="cm-selection-divider" aria-hidden="true" />
          {action("Cite", "Find a source for this passage and cite it after it", "cite")}
        </>
      )}
      {action("Comment", `Comment on the selection (${MOD_LABEL}-${ALT_LABEL}-M)`, "comment")}
      {!readOnly && action("Suggest", `Suggest an edit to the selection (${MOD_LABEL}-${ALT_LABEL}-S)`, "suggest")}
    </div>
  );
}
