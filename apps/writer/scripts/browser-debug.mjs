// Opens a writer URL in headless Chromium, prints console output and takes a screenshot.
import { chromium } from "playwright";
const [url = "http://127.0.0.1:5320/?demo", shot = "out/debug.png", wait = "8000"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? "/home/calluma/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell" });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("console", (m) => { if (!/vite|React DevTools|deprecated/.test(m.text())) console.log("console", m.type(), m.text().slice(0, 300)); });
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 600)));
page.on("worker", (w) => w.on("console", (m) => console.log("worker", m.text().slice(0, 300))));
await page.goto(url);
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: shot });
console.log("title:", await page.title());
await browser.close();
