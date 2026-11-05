// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render } from "../test/render.js";
import { useOverlay } from "./overlays.js";

const media = new EventTarget() as EventTarget & { matches: boolean };
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
const runs: { keyframes: Keyframe[]; options: KeyframeAnimationOptions; finish(): void; cancel: ReturnType<typeof vi.fn> }[] = [];

function Harness({ open }: { open: boolean }) {
  const { host, present } = useOverlay(open, ".test-panel", "translateX(-12px)");
  return <div ref={host}>{present && <aside className="test-panel">Panel</aside>}</div>;
}

beforeEach(() => {
  media.matches = false;
  runs.length = 0;
  vi.stubGlobal("matchMedia", () => media);
  vi.stubGlobal("getComputedStyle", () => ({ opacity: "0.4", transform: "matrix(1, 0, 0, 1, -7, 0)" }));
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: vi.fn((keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    let finish!: () => void;
    let reject!: (error: Error) => void;
    const finished = new Promise<void>((resolve, fail) => { finish = resolve; reject = fail; });
    const cancel = vi.fn(() => reject(new Error("Cancelled")));
    runs.push({ keyframes: keyframes as Keyframe[], options: options as KeyframeAnimationOptions, finish, cancel });
    return { finished, cancel } as unknown as Animation;
  }) });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else Reflect.deleteProperty(HTMLElement.prototype, "animate");
});

it("retains only the visual exit and reverses from its current presentation", async () => {
  const view = render(<Harness open />);
  expect(runs[0]?.options.duration).toBe(160);
  view.rerender(<Harness open={false} />);
  const panel = view.container.querySelector<HTMLElement>("aside")!;
  expect(panel.inert).toBe(true);
  expect(panel.ariaHidden).toBe("true");
  expect(runs[1]?.options.duration).toBe(120);
  expect(runs[1]?.keyframes[0]).toEqual({ opacity: "0.4", transform: "matrix(1, 0, 0, 1, -7, 0)" });
  view.rerender(<Harness open />);
  expect(view.container.querySelector("aside")).toBe(panel);
  expect(panel.inert).toBe(false);
  expect(runs[2]?.options.duration).toBe(160);
  expect(runs[1]?.cancel).toHaveBeenCalledOnce();
  await act(async () => runs[2]?.finish());
  view.rerender(<Harness open={false} />);
  await act(async () => runs[3]?.finish());
  expect(view.container.querySelector("aside")).toBeNull();
});

it("cancels entrance and exit immediately when Reduce changes", () => {
  const view = render(<Harness open />);
  act(() => { media.matches = true; media.dispatchEvent(new Event("change")); });
  expect(runs[0]?.cancel).toHaveBeenCalledOnce();
  view.rerender(<Harness open={false} />);
  expect(view.container.querySelector("aside")).toBeNull();
  expect(runs).toHaveLength(1);
  media.matches = false;
  view.rerender(<Harness open />);
  view.rerender(<Harness open={false} />);
  act(() => { media.matches = true; media.dispatchEvent(new Event("change")); });
  expect(view.container.querySelector("aside")).toBeNull();
  expect(runs[2]?.cancel).toHaveBeenCalledOnce();
});

it("starts no animation under Reduce and cancels owned motion on unmount", () => {
  media.matches = true;
  const view = render(<Harness open />);
  expect(runs).toHaveLength(0);
  media.matches = false;
  view.rerender(<Harness open={false} />);
  view.unmount();
  expect(runs[0]?.cancel).toHaveBeenCalledOnce();
});
