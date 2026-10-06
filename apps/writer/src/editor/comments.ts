// Comment anchors in the editor: commented passages are highlighted, and a
// suggestion shows as a tracked change (the text it replaces struck through,
// its replacement inline after it). Anchors follow edits between updates.
import { RangeSet, RangeSetBuilder, StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, gutter, GutterMarker, hoverTooltip, WidgetType, type DecorationSet } from "@codemirror/view";
import { locate, type CommentTarget } from "@mdbase-writer/core/comments";

export interface CommentAnchor {
  /** The thread's first comment's path. */
  readonly id: string;
  /** Located in the editor's own text when shown; a detached anchor is not shown. */
  readonly target: CommentTarget;
  /** A suggestion's replacement text. */
  readonly replacement?: string;
}

/** What a hover over an anchor shows of its thread. */
export interface AnchorCard {
  readonly kind: "comment" | "suggestion";
  readonly author: string;
  readonly when: string;
  readonly text: string;
  readonly replies: number;
  readonly isNew?: boolean;
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

/** The thread ids anchored on each line, from the first comment's position (for the margin). */
class CommentMarker extends GutterMarker {
  constructor(readonly ids: readonly string[], readonly active: boolean) {
    super();
  }
  override eq(other: CommentMarker) {
    return other.active === this.active && other.ids.join() === this.ids.join();
  }
  override toDOM() {
    const el = document.createElement("button");
    el.type = "button";
    el.className = `cm-comment-marker${this.active ? " is-active" : ""}`;
    el.dataset["comment"] = this.ids[0] ?? "";
    el.textContent = this.ids.length > 1 ? String(this.ids.length) : "";
    el.title = this.ids.length > 1 ? `${this.ids.length} comments on this line` : "Show this comment";
    el.setAttribute("aria-label", el.title);
    return el;
  }
}

const anchorsField = StateField.define<{ anchors: readonly CommentAnchor[]; active: string | null }>({
  create: () => ({ anchors: [], active: null }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setAnchors)) return e.value;
    return value;
  },
});

/** Markers by line: the decoration set already follows edits, so lines come from it. */
function markersFor(decorations: DecorationSet, doc: { lineAt(pos: number): { from: number } }, active: string | null): RangeSet<CommentMarker> {
  const byLine = new Map<number, string[]>();
  const cursor = decorations.iter();
  while (cursor.value) {
    const id = (cursor.value.spec as { attributes?: Record<string, string>; widget?: Insertion }).attributes?.["data-comment"] ?? (cursor.value.spec as { widget?: Insertion }).widget?.id;
    if (id) {
      const line = doc.lineAt(cursor.from).from;
      const ids = byLine.get(line) ?? [];
      if (!ids.includes(id)) ids.push(id);
      byLine.set(line, ids);
    }
    cursor.next();
  }
  const builder = new RangeSetBuilder<CommentMarker>();
  for (const line of [...byLine.keys()].sort((a, b) => a - b)) {
    const ids = byLine.get(line) ?? [];
    builder.add(line, line, new CommentMarker(ids, active !== null && ids.includes(active)));
  }
  return builder.finish();
}

const markerField = StateField.define<RangeSet<CommentMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    const changed = tr.effects.some((e) => e.is(setAnchors));
    if (!changed && !tr.docChanged) return value;
    return markersFor(tr.state.field(anchorField), tr.state.doc, tr.state.field(anchorsField).active);
  },
});

/**
 * Anchors, a click on one (its thread's id), a margin marker on each
 * commented line, and a card on hover saying who said what.
 */
export function commentAnchors(onAnchor: (id: string) => void, card?: (id: string) => AnchorCard | null): Extension {
  const hover = hoverTooltip((view, pos) => {
    if (!card) return null;
    const decorations = view.state.field(anchorField);
    let hit: { id: string; from: number; to: number } | null = null;
    decorations.between(pos, pos, (from, to, value) => {
      const id = (value.spec as { attributes?: Record<string, string> }).attributes?.["data-comment"];
      if (id && !hit) hit = { id, from, to };
    });
    if (!hit) return null;
    const { id, from, to } = hit;
    const info = card(id);
    if (!info) return null;
    return {
      pos: from,
      end: to,
      above: true,
      create: () => {
        const dom = document.createElement("div");
        dom.className = "cm-ref-tip cm-comment-tip";
        const head = document.createElement("div");
        head.className = "cm-ref-kind";
        head.textContent = `${info.kind === "suggestion" ? "Suggestion" : "Comment"}${info.isNew ? " · new" : ""}`;
        const who = document.createElement("div");
        who.className = "cm-comment-who";
        who.textContent = `${info.author} · ${info.when}`;
        const body = document.createElement("div");
        body.className = "cm-ref-body";
        body.textContent = info.text.length > 240 ? `${info.text.slice(0, 239)}…` : info.text;
        const hint = document.createElement("div");
        hint.className = "cm-ref-hint";
        hint.textContent = `${info.replies ? `${info.replies} ${info.replies === 1 ? "reply" : "replies"} · ` : ""}Click to open in Comments`;
        dom.append(head, who, body, hint);
        return { dom };
      },
    };
  }, { hoverTime: 250 });
  return [
    anchorsField,
    anchorField,
    markerField,
    gutter({
      class: "cm-comment-gutter",
      markers: (view) => view.state.field(markerField),
      domEventHandlers: {
        click(_view, _line, event) {
          const id = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-comment]")?.dataset["comment"] : undefined;
          if (!id) return false;
          onAnchor(id);
          return true;
        },
      },
    }),
    hover,
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
