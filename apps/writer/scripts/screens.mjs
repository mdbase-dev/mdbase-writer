import { chromium } from "playwright";
const browser = await chromium.launch({ executablePath: "/home/calluma/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell" });
const shot = async (name, url, { width = 1500, height = 950, scheme = "light", wait = 5000, act } = {}) => {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: scheme });
  await page.goto(url);
  await page.waitForTimeout(wait);
  if (act) await act(page);
  await page.screenshot({ path: `out/screen-${name}.png` });
  await page.close();
};
const base = "http://127.0.0.1:5320/";
await shot("thesis-light", `${base}?demo&manuscript=manuscripts/refusing-the-possible.md`, { act: async (p) => { await p.locator(".record-row", { hasText: "Potentiality" }).click(); await p.waitForTimeout(800); } });
await shot("paper-dark", `${base}?demo&manuscript=manuscripts/potentiality.md`, { scheme: "dark", act: async (p) => { await p.locator(".cm-line", { hasText: "which it occurs" }).first().click(); await p.keyboard.press("End"); await p.keyboard.type(" [@nosuch] [@agamb", { delay: 30 }); await p.waitForTimeout(1500); } });
await shot("mobile-write", `${base}?demo&manuscript=manuscripts/potentiality.md`, { width: 390, height: 844 });
await shot("gate", base, { wait: 6000 });
await browser.close();
