// @vitest-environment jsdom
import { MdbaseError } from "@mdbase-dev/sdk";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ok } from "../backend/types.js";
import { render } from "../test/render.js";
import { SourcesPanel } from "./SourcesPanel.js";

afterEach(cleanup);

it("gives an annotation read failure plain copy and an independent retry", async () => {
  const source = { key: "a", path: "sources/a.md", title: "A source", item: { id: "a", type: "book", title: "A source" } };
  const loadAnnotations = vi.fn(async () => ok([])).mockRejectedValueOnce(new MdbaseError({ code: "unavailable", recovery: "retry", reason: "device_offline", message: "raw_transport_error" }));
  render(<SourcesPanel query="" setQuery={vi.fn()} library={[source]} cited={new Map()} loadAnnotations={loadAnnotations} canInsert onInsert={vi.fn()} onStepCitation={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /^A source/, expanded: false }));
  const banner = await screen.findByRole("alert");
  expect(banner.textContent).toContain("Open mdbase on the computer that holds this collection, then try again.");
  expect(banner.textContent).not.toContain("raw_transport_error");
  expect(banner.querySelector("details")?.open).toBe(false);
  fireEvent.click(within(banner).getByText("Technical details"));
  expect(banner.querySelector("details")?.open).toBe(true);
  expect(banner.querySelector("code")?.textContent).toBe("unavailable: device_offline");
  fireEvent.click(within(banner).getByRole("button", { name: "Retry annotations" }));
  expect(await screen.findByText("No annotations on this source.")).toBeTruthy();
  expect(loadAnnotations).toHaveBeenCalledTimes(2);
});

it("keeps technical details available when the first library read returns no rows", () => {
  render(<SourcesPanel query="" setQuery={vi.fn()} library={[]} cited={new Map()} loadAnnotations={vi.fn()}
    canInsert onInsert={vi.fn()} onStepCitation={vi.fn()} onRetry={vi.fn()}
    problem="The library changed while loading. Try again." details="invalid_request: cursor_stale" />);
  const details = screen.getByText("Technical details").closest("details")!;
  expect(details.open).toBe(false);
  fireEvent.click(screen.getByText("Technical details"));
  expect(details.open).toBe(true);
  expect(details.querySelector("code")?.textContent).toBe("invalid_request: cursor_stale");
  expect(screen.getByRole("button", { name: "Retry sources" })).toBeTruthy();
});
