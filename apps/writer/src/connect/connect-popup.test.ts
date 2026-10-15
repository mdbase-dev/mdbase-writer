import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectPopupBlocked, openConnectPopup } from "./connect-popup.js";
import { createSignInPortalUi } from "./native-signin-ui.js";

afterEach(() => vi.unstubAllGlobals());

function handle() {
  return { opener: {}, closed: false, location: { href: "" }, close: vi.fn() };
}

describe("UI-owned popup handles, not native authentication", () => {
  it("uses a detached fallback tab if the popup throws", () => {
    const tab = handle();
    const open = vi
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("blocked");
      })
      .mockReturnValue(tab);
    vi.stubGlobal("window", { open });
    const portal = openConnectPopup();
    expect(open).toHaveBeenLastCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    portal.navigate("https://mdbase.test/approve");
    expect(tab.location.href).toBe("https://mdbase.test/approve");
  });
  it("reports an actually blocked popup and fallback", () => {
    vi.stubGlobal("window", { open: () => null });
    expect(openConnectPopup).toThrow(ConnectPopupBlocked);
  });
  it("closes idempotently and refuses late navigation of a disposed handle", () => {
    const popup = handle();
    vi.stubGlobal("window", { open: () => popup });
    const portal = openConnectPopup();
    portal.close();
    portal.close();
    expect(popup.close).toHaveBeenCalledOnce();
    expect(() => portal.navigate("https://mdbase.test/late")).toThrow(
      "Sign-in window closed.",
    );
  });
  it("keeps the original handle after SDK handoff and reuses it for reopen", () => {
    const popup = handle();
    const open = vi.fn(() => popup);
    vi.stubGlobal("window", { open });
    const ui = createSignInPortalUi();
    ui.reserve();
    const original = ui.open();
    ui.reserve();
    expect(ui.open()).toBe(original);
    expect(open).toHaveBeenCalledOnce();
    ui.cancel();
    ui.cancel();
    expect(popup.close).toHaveBeenCalledOnce();
  });
  it("reopens a manually closed popup without sharing a retired owner's name", () => {
    const first = handle();
    const second = handle();
    const open = vi.fn().mockReturnValueOnce(first).mockReturnValue(second);
    vi.stubGlobal("window", { open });
    const ui = createSignInPortalUi();
    ui.reserve();
    const original = ui.open();
    first.closed = true;
    ui.reserve();
    expect(ui.open()).not.toBe(original);
    createSignInPortalUi().reserve();
    expect(open.mock.calls[0]?.[1]).toBe(open.mock.calls[1]?.[1]);
    expect(open.mock.calls[2]?.[1]).not.toBe(open.mock.calls[0]?.[1]);
  });
  it("does not turn display cleanup failure into an approval error", () => {
    const popup = handle();
    popup.close.mockImplementation(() => {
      throw new Error("display cleanup");
    });
    vi.stubGlobal("window", { open: () => popup });
    const portal = openConnectPopup();
    expect(() => portal.close()).not.toThrow();
    portal.close();
    expect(popup.close).toHaveBeenCalledOnce();
  });
});
