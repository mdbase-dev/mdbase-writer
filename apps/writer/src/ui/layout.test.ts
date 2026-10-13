import { describe, expect, it, vi } from "vitest";

import { clampSidebar, DEFAULT_LAYOUT, gridFor, loadLayout, saveLayout } from "./layout.js";

it.each([true, false])("ignores obsolete join-lines preference %s and preserves other layout settings", (joinLines) => {
  const storage = { getItem: () => JSON.stringify({ ...DEFAULT_LAYOUT, sidebarWidth: 310, joinLines }), setItem: vi.fn() };
  vi.stubGlobal("localStorage", storage);
  try {
    const layout = loadLayout();
    expect(layout).toEqual({ ...DEFAULT_LAYOUT, sidebarWidth: 310 });
    expect(layout).not.toHaveProperty("joinLines");
    saveLayout(layout);
    expect(storage.setItem).toHaveBeenCalledWith("mdbase-writer:layout", JSON.stringify(layout));
  } finally { vi.unstubAllGlobals(); }
});

describe("gridFor", () => {
  it("gives the sidebar its width, within bounds", () => {
    expect(gridFor({ ...DEFAULT_LAYOUT, sidebarWidth: 320 }).columns).toMatch(/^320px /);
    expect(gridFor({ ...DEFAULT_LAYOUT, sidebarWidth: 90 }).columns).toMatch(/^200px /);
    // Hidden, the sidebar leaves a rail of its tabs.
    expect(gridFor({ ...DEFAULT_LAYOUT, sidebar: false }).areas).toBe(`"rail write divider preview"`);
    expect(gridFor({ ...DEFAULT_LAYOUT, sidebar: false }).columns.startsWith("44px")).toBe(true);
  });
  it("rounds and bounds a dragged width", () => {
    expect(clampSidebar(333.6)).toBe(334);
    expect(clampSidebar(9999)).toBe(520);
  });
});
