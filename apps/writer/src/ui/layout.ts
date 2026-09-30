// How the workspace is laid out, remembered in this browser (all mdbase
// writer manuscripts share it).
export type View = "write" | "both" | "preview";
export type SidebarTab = "outline" | "sources" | "comments";

export interface Layout {
  readonly sidebar: boolean;
  readonly tab: SidebarTab;
  /** The sidebar's width in CSS pixels. */
  readonly sidebarWidth: number;
  readonly view: View;
  /** The editor's share of the width it splits with the preview. */
  readonly split: number;
  readonly zoom: number | "fit";
  /** Hard-wrapped paragraphs flow in the editor (their soft line breaks drawn as spaces). */
  readonly joinLines: boolean;
}

const KEY = "mdbase-writer:layout";
export const DEFAULT_LAYOUT: Layout = { sidebar: true, tab: "outline", sidebarWidth: 272, view: "both", split: 0.5, zoom: "fit", joinLines: true };
export const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;

export const SIDEBAR_MIN = 200;
export const SIDEBAR_MAX = 520;
export const clampSidebar = (width: number) => Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width)));
export const clampSplit = (split: number) => Math.min(0.8, Math.max(0.2, split));

export function loadLayout(): Layout {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Layout>;
    return {
      sidebar: typeof raw.sidebar === "boolean" ? raw.sidebar : DEFAULT_LAYOUT.sidebar,
      tab: raw.tab === "sources" || raw.tab === "comments" ? raw.tab : "outline",
      sidebarWidth: typeof raw.sidebarWidth === "number" ? clampSidebar(raw.sidebarWidth) : DEFAULT_LAYOUT.sidebarWidth,
      view: raw.view === "write" || raw.view === "preview" || raw.view === "both" ? raw.view : DEFAULT_LAYOUT.view,
      split: typeof raw.split === "number" ? clampSplit(raw.split) : DEFAULT_LAYOUT.split,
      joinLines: typeof raw.joinLines === "boolean" ? raw.joinLines : DEFAULT_LAYOUT.joinLines,
      zoom: raw.zoom === "fit" || (typeof raw.zoom === "number" && raw.zoom >= 0.25 && raw.zoom <= 4) ? raw.zoom : DEFAULT_LAYOUT.zoom,
    };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: Layout): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(layout));
  } catch {
    // Storage may be unavailable (private windows); the layout lasts for this page.
  }
}

/** Grid columns and areas for the desktop workspace. */
export function gridFor(layout: Layout): { columns: string; areas: string } {
  const cols: [string, string][] = [];
  if (layout.sidebar) cols.push([`${clampSidebar(layout.sidebarWidth)}px`, "outline"]);
  if (layout.view !== "preview") cols.push([`minmax(0, ${layout.view === "both" ? layout.split : 1}fr)`, "write"]);
  if (layout.view === "both") cols.push(["7px", "divider"]);
  if (layout.view !== "write") cols.push([`minmax(0, ${layout.view === "both" ? 1 - layout.split : 1}fr)`, "preview"]);
  return { columns: cols.map((c) => c[0]).join(" "), areas: `"${cols.map((c) => c[1]).join(" ")}"` };
}

export function nextZoom(scale: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_STEPS.find((z) => z > scale + 0.01) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1]!;
  return [...ZOOM_STEPS].reverse().find((z) => z < scale - 0.01) ?? ZOOM_STEPS[0];
}
