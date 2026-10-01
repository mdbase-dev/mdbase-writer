import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SourcesPanel } from "./SourcesPanel.js";
import { CommentsPanel } from "./CommentsPanel.js";
import { NO_PEOPLE } from "../backend/comments.js";
import { ok } from "../backend/types.js";
vi.mock("../apps.js", () => ({ readerSourceHref: () => undefined }));
const sources = { library: [], cited: new Map(), canInsert: true, loadAnnotations: async () => ok([]), onInsert() {}, onStepCitation() {} };
describe("quiet panel states and bounds", () => {
  it("distinguishes loading, failure, not set up and empty sources", () => {
    const show = (extra: object) => renderToStaticMarkup(createElement(SourcesPanel, { ...sources, ...extra }));
    expect(show({ loading: true })).toContain("Loading sources");
    expect(show({ problem: "Denied", onRetry() {} })).toContain("Retry sources");
    expect(show({ notSetUp: true })).toContain("not set up");
    expect(show({})).toContain("No sources in this collection");
    expect(show({ loading: true })).not.toContain("No sources in this collection");
  });
  it("initial source mounting is bounded in both cited and library groups", () => {
    const library = Array.from({ length: 5000 }, (_, i) => ({ key: String(i), path: `${i}.md`, title: String(i), item: { id: String(i) } }));
    const html = renderToStaticMarkup(createElement(SourcesPanel, { ...sources, library, cited: new Map(library.slice(0, 100).map((e) => [e.key, 1])) }));
    expect(html.match(/class="source-row"/g)).toHaveLength(70);
    expect(html).toContain("Show 50 more sources");
  });
  it("distinguishes comments not set up from an empty ready list", () => {
    const props = { placed: [], people: NO_PEOPLE, active: null, pending: null, recordTitle: (p: string) => p, onSelect() {}, onSubmit: async () => ok(null), onCancel() {}, onReply: async () => ok(null), onChange: async () => ok(null), onAccept: async () => ok(null), onWholeRecord() {}, onCheckAccount: async () => null };
    const html = renderToStaticMarkup(createElement(CommentsPanel, { ...props, notSetUp: true }));
    expect(html).toContain("Comments are not set up");
    expect(html).not.toContain("No open comments");
  });
});
