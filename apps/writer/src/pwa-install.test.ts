// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { setupPwaInstall } from "./pwa-install.js";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); localStorage.clear(); });

it("shows installation only inside the application and removes it when a gate replaces the application", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  document.body.innerHTML = '<div id="root"><main class="gate"></main></div>';
  const stop = setupPwaInstall("Writer");
  try {
    window.dispatchEvent(new Event("beforeinstallprompt", { cancelable: true }));
    vi.advanceTimersByTime(30_000);
    expect(document.querySelector(".pwa-install")).toBeNull();
    document.getElementById("root")!.innerHTML = '<main class="home"></main>';
    await Promise.resolve();
    expect(document.querySelector(".pwa-install")).not.toBeNull();
    document.getElementById("root")!.innerHTML = '<main class="gate"></main>';
    await Promise.resolve();
    expect(document.querySelector(".pwa-install")).toBeNull();
  } finally { stop(); }
  expect(vi.getTimerCount()).toBe(0);
});
