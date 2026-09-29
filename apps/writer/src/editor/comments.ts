// Comment anchors in the editor: commented passages are highlighted, and a
// suggestion shows as a tracked change (the text it replaces struck through,
// its replacement inline after it). Anchors follow edits between updates.
import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";
import { locate, type CommentTarget } from "@mdbase-writer/core/comments";

export interface CommentAnchor {
  /** The thread's first comment's path. */
  readonly id: string;
  /** Located in the editor's own text when shown; a detached anchor is not shown. */
  readonly target: CommentTarget;
  /** A suggestion's replacement text. */
  readonly replacement?: string;
}

const setAnchors = StateEffect.define<{ anchors: readonly CommentAnchor[]; active: string | null }>();

class Insertion extends WidgetType {
  constructor(
    readonly id: string,
    readonly text: string,
    readonly active: boolean,
  ) {
    super();
  }

  override eq(other: Insertion): boolean {
    return other.id === this.id && other.text === this.text && other.active === this.active;
  }

  toDOM(): HTMLElement {
    const span = document.createElement("span");
    // An empty insertion is a comment on a point between two characters.
    span.className = `${this.text ? "cm-suggest-insert" : "cm-comment-point"}${this.active ? " is-active" : ""}`;
    span.dataset["comment"] = this.id;
    span.textContent = this.text;
    span.title = this.text ? "Suggested insertion" : "Comment";
    return span;
  }

  override ignoreEvent(): boolean {
    return false;
  }
}

function decorations(text: string, anchors: readonly CommentAnchor[], active: string | null): DecorationSet {
  const ranges = [];
  for (const a of anchors) {
    const at = locate(text, a.target);
    if (!at) continue;
    const { from, to } = at;
    const isActive = a.id === active;
    const suggestion = a.replacement !== undefined;
    if (to > from) {
      const className = `${suggestion ? "cm-suggest-delete" : "cm-comment"}${isActive ? " is-active" : ""}`;
      // A suggestion that only replaces is still a deletion followed by an insertion.
      ranges.push(Decoration.mark({ class: className, attributes: { "data-comment": a.id } }).range(from, to));
    }
    if (suggestion && a.replacement) ranges.push(Decoration.widget({ widget: new Insertion(a.id, a.replacement, isActive), side: 1 }).range(to));
    else if (!suggestion && to === from) ranges.push(Decoration.widget({ widget: new Insertion(a.id, "", isActive), side: 1 }).range(to));
  }
  return Decoration.set(ranges, true);
}

const anchorField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setAnchors)) return decorations(tr.state.doc.toString(), e.value.anchors, e.value.active);
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Anchors, and a click on one (its thread's id). */
export function commentAnchors(onAnchor: (id: string) => void): Extension {
  return [
    anchorField,
    EditorView.domEventHandlers({
      click(event) {
        const hit = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-comment]") : null;
        const id = hit?.dataset["comment"];
        if (id) onAnchor(id);
        return false;
      },
    }),
  ];
}

export function showAnchors(view: EditorView, anchors: readonly CommentAnchor[], active: string | null): void {
  view.dispatch({ effects: setAnchors.of({ anchors, active }) });
}
