import { describe, expect, it } from "vitest";

import { clampSidebar, DEFAULT_LAYOUT, gridFor } from "./layout.js";

describe("gridFor", () => {
  it("gives the sidebar its width, within bounds", () => {
    expect(gridFor({ ...DEFAULT_LAYOUT, sidebarWidth: 320 }).columns).toMatch(/^320px /);
    expect(gridFor({ ...DEFAULT_LAYOUT, sidebarWidth: 90 }).columns).toMatch(/^200px /);
    expect(gridFor({ ...DEFAULT_LAYOUT, sidebar: false }).areas).toBe(`"write divider preview"`);
  });
  it("rounds and bounds a dragged width", () => {
    expect(clampSidebar(333.6)).toBe(334);
    expect(clampSidebar(9999)).toBe(520);
  });
});
