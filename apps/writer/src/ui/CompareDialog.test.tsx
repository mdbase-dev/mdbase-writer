// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { changedPassage, CompareDialog, type Comparison } from "./CompareDialog.js";

vi.mock("@mdbase-dev/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <section role="dialog">{children}</section> : null,
}));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("highlights a late change and scrolls both text panes to it, not the page", () => {
  const prefix = Array.from({ length: 100 }, (_, index) => `Unchanged line ${index}`).join("\n");
  const mine = `${prefix}\nLocal draft addition\nUnchanged suffix`;
  const theirs = `${prefix}\nSaved collection line\nUnchanged suffix`;
  expect(changedPassage(mine, theirs)).toEqual({ prefix, mine: "Local draft addition", theirs: "Saved collection line", suffix: "Unchanged suffix" });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function(this: HTMLElement) {
    return { top: this.tagName === "MARK" ? 1000 : 100 } as DOMRect;
  });
  const rendered = render(<CompareDialog comparison={{ path: "main.md", kind: "draft", mine, theirs, mineFields: {}, theirFields: {} }} onClose={vi.fn()} onResolve={vi.fn()} onDownload={vi.fn()} />);
  expect([...rendered.container.querySelectorAll("mark")].map(mark => mark.textContent)).toEqual(["Local draft addition", "Saved collection line"]);
  expect([...rendered.container.querySelectorAll(".compare-text")].map(text => text.scrollTop)).toEqual([868, 868]);
  expect(window.scrollY).toBe(0);
  expect(screen.getByRole("button", { name: "Restore local draft" })).toBeTruthy();
});

it("keeps an edited merge across unrelated renders and resets it for a new local version", () => {
  const comparison: Comparison = { path: "main.md", kind: "conflict", mine: "Local text", theirs: "Collection text", mineFields: {}, theirFields: {} };
  const callbacks = { onClose: vi.fn(), onResolve: vi.fn(), onDownload: vi.fn() };
  const rendered = render(<CompareDialog comparison={comparison} {...callbacks} />);
  const field = () => screen.getByRole<HTMLTextAreaElement>("textbox", { name: /Merged Markdown/ });
  expect(field().value).toBe("Local text");
  fireEvent.change(field(), { target: { value: "Reviewed merged text" } });
  rendered.rerender(<CompareDialog comparison={{ ...comparison, theirFields: { template: "article" } }} {...callbacks} />);
  expect(field().value).toBe("Reviewed merged text");
  rendered.rerender(<CompareDialog comparison={{ ...comparison, mine: "New local version" }} {...callbacks} />);
  expect(field().value).toBe("New local version");
});
