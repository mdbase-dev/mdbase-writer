// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { connectionNotice, SYNC_DELAY_MS, useConnectionNotice } from "./connection-notice.js";

const ready = { phase: { kind: "ready" } } as const;
const sync = (health: string | null, live: boolean | null = true) =>
  ({ kind: "synced", health, live }) as never;

it("never reads as connected while offline, reconnecting or holding changes", () => {
  expect(connectionNotice({ ...ready, sync: sync(null) } as never)).toBeNull();
  expect(connectionNotice({ ...ready, sync: sync(null) } as never, false)).toBe(
    "offline",
  );
  expect(connectionNotice({ ...ready, sync: sync("offline") } as never)).toBe(
    "offline",
  );
  expect(
    connectionNotice({ ...ready, sync: sync("unreachable") } as never),
  ).toBe("reconnecting");
  expect(connectionNotice({ ...ready, sync: sync(null, false) } as never)).toBe(
    "reconnecting",
  );
  expect(
    connectionNotice({
      ...ready,
      sync: sync("offline"),
      writes: { saveState: "saved_on_device", pending: [], rejected: [] },
    } as never),
  ).toBe("offline");
  expect(connectionNotice({ ...ready, writes: { saveState: "saved_on_device", pending: [], rejected: [] } } as never)).toBe("saved_on_device");
  expect(
    connectionNotice({ phase: { kind: "opening" }, live: false } as never),
  ).toBeNull();
});

it("escalates at 30 seconds without an SDK snapshot change and clears when confirmed", () => {
  const snapshot = { ...ready, writes: { pending: [{ createdAt: 1000 }], rejected: [], saveState: "saving" } } as never;
  expect(connectionNotice(snapshot, true, 1000 + SYNC_DELAY_MS - 1)).toBeNull();
  expect(connectionNotice(snapshot, true, 1000 + SYNC_DELAY_MS)).toBe("sync_delayed");
  expect(connectionNotice({ ...ready, writes: { pending: [], rejected: [], saveState: "saved" } } as never, true, 100000)).toBeNull();
});

it("shows refused writes immediately without acknowledging or stopping SDK retries", () => {
  const rejected = [{ createdAt: 1000, state: "rejected" }];
  const snapshot = { ...ready, writes: { pending: [], rejected, saveState: "rejected" } } as never;
  expect(connectionNotice(snapshot, true, 1001)).toBe("sync_delayed");
  expect(rejected).toHaveLength(1);
});

it("announces the pending boundary without a new snapshot and cancels its timer on confirmation", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  let snapshot = { ...ready, writes: { pending: [{ createdAt: 1000 }], rejected: [], saveState: "saving" } } as never;
  let notify = () => {};
  const source = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => { notify = listener; return () => {}; } };
  const hook = renderHook(() => useConnectionNotice(source));
  try {
    expect(hook.result.current).toBeNull();
    act(() => vi.advanceTimersByTime(SYNC_DELAY_MS - 1));
    expect(hook.result.current).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(hook.result.current).toBe("sync_delayed");
    snapshot = { ...ready, writes: { pending: [], rejected: [], saveState: "saved" } } as never;
    act(notify);
    expect(hook.result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  } finally { hook.unmount(); vi.useRealTimers(); }
});
