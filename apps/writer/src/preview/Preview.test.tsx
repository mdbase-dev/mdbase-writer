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

it.each(["running", "pending", "during-render"])("holds preview drawing through a %s sidebar animation without fading prose", async state => {
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
  let completeMotion!: () => void;
  const finished = new Promise<void>(resolve => { completeMotion = resolve; });
  const animation = { playState: state === "pending" ? "idle" : "running", pending: state === "pending", finished } as unknown as Animation;
  const finish = () => { Object.assign(animation, { playState: "finished", pending: false }); completeMotion(); };
  let finishRender!: () => void;
  const rendered = new Promise<{ cacheKey: string }>(resolve => { finishRender = () => resolve({ cacheKey: "page" }); });
  if (state === "during-render") renderer.renderCanvas.mockImplementationOnce(() => rendered);
  try {
    const view = render(<div className="workspace"><aside className="outline" /><div className="write" /><Preview visible artifact={new Uint8Array([1])} revision={1} positions={[]} stale={false} onRetry={() => {}} onJump={() => {}} zoom="fit" /></div>);
    const outline = view.container.querySelector(".outline")!;
    const sidebarAnimations = vi.fn(() => state === "during-render" ? [] as Animation[] : [animation]);
    Object.defineProperty(outline, "getAnimations", { value: sidebarAnimations });
    await waitFor(() => expect(sidebarAnimations).toHaveBeenCalled());
    if (state === "during-render") {
      await waitFor(() => expect(renderer.renderCanvas).toHaveBeenCalled());
      sidebarAnimations.mockReturnValue([animation]);
      const before = sidebarAnimations.mock.calls.length;
      await act(async () => { finishRender(); await rendered; });
      await waitFor(() => expect(sidebarAnimations.mock.calls.length).toBeGreaterThan(before));
      expect(view.container.querySelector("canvas")?.dataset["version"]).toBeUndefined();
    } else expect(renderer.renderCanvas).not.toHaveBeenCalled();
    expect(view.container.querySelector(".write")!.getAnimations()).toEqual([]);
    await act(async () => { finish(); await finished; });
    await waitFor(() => expect(renderer.renderCanvas).toHaveBeenCalled());
    await waitFor(() => expect(view.container.querySelector("canvas")?.dataset["version"]).toBe("1"));
  } finally {
    finish();
    finishRender();
    if (originalAnimations) Object.defineProperty(Element.prototype, "getAnimations", originalAnimations);
    else Reflect.deleteProperty(Element.prototype, "getAnimations");
    if (originalVisibility) Object.defineProperty(HTMLElement.prototype, "checkVisibility", originalVisibility);
    else Reflect.deleteProperty(HTMLElement.prototype, "checkVisibility");
  }
});
