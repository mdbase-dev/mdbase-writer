import { chromium } from "playwright";
const [url, wait = "10000"] = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: "/home/calluma/.cache/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-linux64/chrome-headless-shell" });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", (e) => console.log("pageerror", String(e).slice(0, 600)));
page.on("requestfailed", (r) => console.log("requestfailed", r.url(), r.failure()?.errorText));
page.on("response", (r) => { if (r.status() >= 400) console.log("http", r.status(), r.url()); });
page.on("worker", (w) => { w.on("console", (m) => console.log("worker", m.type(), m.text().slice(0, 400))); });
page.on("console", (m) => { if (m.type() === "error") console.log("console error", m.text().slice(0, 400)); });
await page.goto(url);
await page.waitForTimeout(Number(wait));
console.log(JSON.stringify(await page.evaluate(() => {
  const s = window.writer?.workspace?.getSnapshot();
  return s && { phase: s.phase, problem: s.problem, compiling: s.compiling, records: [...s.records.keys()], result: s.result && { revision: s.result.revision, diagnostics: s.result.diagnostics.slice(0, 8), timings: s.result.timings, order: s.result.order, hasArtifact: !!s.result.artifact }, library: s.library.length };
}), null, 1));
await browser.close();
