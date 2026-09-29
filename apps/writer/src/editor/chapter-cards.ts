// A record embedded on a line of its own (a chapter) is drawn as a card: its
// title, words and problems, and a button that opens it. The Markdown stays
// as written; putting the cursor on the line shows it for editing.
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

import { EMBED_LINE } from "../workspace/chapters.js";

export interface ChapterCard {
  /** Collection path the embed resolves to; null when nothing matches. */
  readonly path: string | null;
  readonly title: string;
  readonly words?: number;
  readonly problems?: number;
}

/** What the editor needs to draw chapter cards: each embed target's card, and opening one. */
export interface ChapterCards {
  card(target: string): ChapterCard;
  open(path: string): void;
}

/** Asks the cards to redraw (their records' titles, words or problems changed). */
export const refreshChapterCards = StateEffect.define<null>();

const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

class CardWidget extends WidgetType {
  constructor(
    readonly number: number,
    readonly target: string,
    readonly card: ChapterCard,
    readonly open: (path: string) => void,
  ) {
    super();
  }

  override eq(other: CardWidget) {
    return other.number === this.number && other.target === this.target && JSON.stringify(other.card) === JSON.stringify(this.card);
  }

  toDOM() {
    const { card } = this;
    const dom = document.createElement("div");
    dom.className = `cm-chapter-card${card.path ? "" : " is-missing"}`;
    const number = document.createElement("span");
    number.className = "cm-chapter-number";
    number.textContent = String(this.number);
    const text = document.createElement("span");
    text.className = "cm-chapter-text";
    const title = document.createElement("span");
    title.className = "cm-chapter-title";
    title.textContent = card.title;
    const meta = document.createElement("span");
    meta.className = "cm-chapter-meta";
    meta.textContent = card.path
      ? [card.words !== undefined ? plural(card.words, "word") : null, card.problems ? plural(card.problems, "problem") : null, card.path].filter(Boolean).join(" · ")
      : `No record matches ![[${this.target}]]`;
    text.append(title, meta);
    dom.append(number, text);
    if (card.path) {
      const path = card.path;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mdbase-button cm-chapter-open";
      button.textContent = "Open";
      button.setAttribute("aria-label", `Open ${card.title}`);
      button.addEventListener("click", (e) => {
        e.preventDefault();
        this.open(path);
      });
      dom.append(button);
    }
    return dom;
  }

  // The Open button handles its own clicks; a click elsewhere puts the cursor on the line.
  override ignoreEvent(event: Event) {
    return event.target instanceof Element && Boolean(event.target.closest("button"));
  }
}

function build(state: EditorState, cards: () => ChapterCards | undefined): DecorationSet {
  const source = cards();
  if (!source) return Decoration.none;
  const ranges = [];
  const selection = state.selection.ranges;
  let number = 0;
  for (let i = 1; i <= state.doc.lines; i++) {
    const line = state.doc.line(i);
    const target = EMBED_LINE.exec(line.text)?.[1]?.split(/[|#]/)[0]?.trim();
    if (!target) continue;
    number++;
    // The line being edited shows its Markdown.
    if (selection.some((r) => r.to >= line.from && r.from <= line.to)) continue;
    ranges.push(Decoration.replace({ widget: new CardWidget(number, target, source.card(target), source.open), block: true }).range(line.from, line.to));
  }
  return Decoration.set(ranges);
}

export function chapterCards(cards: () => ChapterCards | undefined): Extension {
  return StateField.define<DecorationSet>({
    create: (state) => build(state, cards),
    update(value, tr) {
      if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(refreshChapterCards))) return build(tr.state, cards);
      return value;
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
