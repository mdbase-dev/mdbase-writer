// A record embedded on a line of its own (a chapter) is drawn as a card: its
// title, words and problems, and a button that opens it. An embedded Reader
// annotation is drawn as the quotation it renders, with a button that detaches
// it (writes the quotation in its place, to edit). The Markdown stays as
// written; putting the cursor on the line shows it for editing.
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, type DecorationSet } from "@codemirror/view";

import { embedTarget } from "../workspace/chapters.js";

export interface ChapterCard {
  /** Collection path the embed resolves to; null when nothing matches. */
  readonly path: string | null;
  readonly title: string;
  readonly words?: number;
  readonly problems?: number;
}

/** An embedded annotation: the quotation it renders. */
export interface QuotationCard {
  readonly quotation: true;
  readonly path: string;
  readonly quote: string;
  /** Who and where, as the reader sees it ("Badiou, 2007, p. 178"); empty when the source is not in the library. */
  readonly cite: string;
  /** Opens the quoted passage in Reader, where there is one. */
  readonly href?: string;
  /** The Markdown that replaces the embed when it is detached. */
  readonly detached: string;
}

/** What the editor needs to draw chapter cards: each embed target's card, and opening one. */
export interface ChapterCards {
  card(target: string): ChapterCard | QuotationCard;
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

class QuotationWidget extends WidgetType {
  constructor(readonly card: QuotationCard) {
    super();
  }

  override eq(other: QuotationWidget) {
    return JSON.stringify(other.card) === JSON.stringify(this.card);
  }

  toDOM(view: EditorView) {
    const { card } = this;
    const dom = document.createElement("div");
    dom.className = "cm-quote-card";
    const quote = document.createElement("blockquote");
    quote.className = "cm-quote-text";
    quote.textContent = card.quote;
    const meta = document.createElement("div");
    meta.className = "cm-quote-meta";
    const cite = document.createElement(card.href ? "a" : "span");
    cite.textContent = card.cite ? `${card.cite} · from Reader` : "From Reader · its source is not in the library";
    cite.title = card.href ? "Open this passage in Reader" : card.path;
    if (cite instanceof HTMLAnchorElement && card.href) {
      cite.href = card.href;
      cite.target = "_blank";
      cite.rel = "noopener";
      cite.className = "cm-quote-source";
    }
    const detach = document.createElement("button");
    detach.type = "button";
    detach.className = "text-button";
    detach.textContent = "Detach";
    detach.title = "Write the quotation here, to edit it; it no longer follows the annotation";
    detach.addEventListener("click", (e) => {
      e.preventDefault();
      const line = view.state.doc.lineAt(view.posAtDOM(dom));
      view.dispatch({ changes: { from: line.from, to: line.to, insert: card.detached }, userEvent: "input.detach" });
      view.focus();
    });
    meta.append(cite, detach);
    dom.append(quote, meta);
    return dom;
  }

  // Detach and the link handle their own clicks; a click elsewhere puts the cursor on the line.
  override ignoreEvent(event: Event) {
    return event.target instanceof Element && Boolean(event.target.closest("button, a"));
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
    const target = embedTarget(line.text);
    if (!target) continue;
    const card = source.card(target);
    if (!("quotation" in card)) number++;
    // The line being edited shows its Markdown.
    if (selection.some((r) => r.to >= line.from && r.from <= line.to)) continue;
    const widget = "quotation" in card ? new QuotationWidget(card) : new CardWidget(number, target, card, source.open);
    ranges.push(Decoration.replace({ widget, block: true }).range(line.from, line.to));
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
