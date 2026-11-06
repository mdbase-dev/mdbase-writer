// @vitest-environment jsdom
import { act, cleanup, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { render } from "../test/render.js";
import { Preview } from "./Preview.js";

const renderer = vi.hoisted(() => ({
  init: vi.fn(async () => {}),
  manipulateData: vi.fn(),
  renderCanvas: vi.fn(async () => ({ cacheKey: "page" })),
  runWithSession: vi.fn((callback: (session: unknown) => Promise<void>) => callback({ retrievePagesInfo: () => [{ width: 200, height: 300 }] })),
}));
vi.mock("@myriaddreamin/typst.ts/renderer", () => ({ createTypstRenderer: () => renderer }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); renderer.renderCanvas.mockClear(); });

it.each(["running", "pending"])("holds preview drawing through a %s sidebar animation without fading prose", async state => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("IntersectionObserver", class {
    constructor(private callback: (entries: { target: Element; isIntersecting: boolean }[]) => void) {}
    observe(target: Element) { this.callback([{ target, isIntersecting: true }]); }
    disconnect() {}
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(200);
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D);
  const getAnimations = vi.fn(() => [] as Animation[]);
  const originalAnimations = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
  const originalVisibility = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "checkVisibility");
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: getAnimations });
  Object.defineProperty(HTMLElement.prototype, "checkVisibility", { configurable: true, value: () => true });
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  const animation = { playState: state === "running" ? "running" : "idle", pending: state === "pending", finished } as unknown as Animation;
  try {
    const view = render(<div className="workspace"><aside className="outline" /><div className="write" /><Preview visible artifact={new Uint8Array([1])} revision={1} positions={[]} stale={false} onRetry={() => {}} onJump={() => {}} zoom="fit" /></div>);
    const outline = view.container.querySelector(".outline")!;
    const sidebarAnimations = vi.fn(() => [animation]);
    Object.defineProperty(outline, "getAnimations", { value: sidebarAnimations });
    await waitFor(() => expect(sidebarAnimations).toHaveBeenCalled());
    expect(renderer.renderCanvas).not.toHaveBeenCalled();
    expect(view.container.querySelector(".write")!.getAnimations()).toEqual([]);
    await act(async () => { finish(); await finished; });
    await waitFor(() => expect(renderer.renderCanvas).toHaveBeenCalled());
    await waitFor(() => expect(view.container.querySelector("canvas")?.dataset["version"]).toBe("1"));
  } finally {
    finish();
    if (originalAnimations) Object.defineProperty(Element.prototype, "getAnimations", originalAnimations);
    else Reflect.deleteProperty(Element.prototype, "getAnimations");
    if (originalVisibility) Object.defineProperty(HTMLElement.prototype, "checkVisibility", originalVisibility);
    else Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility");
  }
});
