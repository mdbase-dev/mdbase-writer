// Use the DEV-only large manuscript and the real Word download controls.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.BASE ?? "http://127.0.0.1:5320/";
const output = resolve(process.env.PROFILE_OUTPUT ?? "out/perf/docx");
const referencePath = process.env.PROFILE_REFERENCE;
const runs = Number(process.env.PROFILE_RUNS ?? 3);
assert.ok(Number.isInteger(runs) && runs > 0, "PROFILE_RUNS must be a positive integer");
const manuscript = "manuscripts/main.md";
const chapter = "chapters/chapter-00000.md";
const typed = " ordinary typing";
await mkdir(output, { recursive: true });

// Validate every ZIP entry and fingerprint the uncompressed package. Pandoc
// records the export time in core.xml and in the ZIP container.
const inspect = String.raw`
import hashlib, json, sys, zipfile
from xml.etree import ElementTree as ET

w = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
terms = "{http://purl.org/dc/terms/}"
def text(root):
    return "".join(n.text or "" for n in root.iter(w + "t"))

with zipfile.ZipFile(sys.argv[1]) as package:
    assert package.testzip() is None
    doc = ET.fromstring(package.read("word/document.xml"))
    paragraphs = [text(p) for p in doc.iter(w + "p")]
    for chapter in range(1, 61):
        for section in range(1, 9):
            expected = (f"Evidence in chapter {chapter}, section {section}, supports the manuscript’s "
                        "argument. Further analysis puts the result in context.")
            assert any(p.startswith(expected) for p in paragraphs), expected
    assert text(doc).count(" ordinary typing" * 24) == 1
    assert "Bibliography" in paragraphs
    assert "Synthetic research 00099" in text(doc)
    assert "Author00099, 2024" in text(doc)
    assert list(doc.iter(w + "footnoteReference"))
    footnotes = ET.fromstring(package.read("word/footnotes.xml"))
    assert "Footnote text with a citation (Author00000, 2000)." in text(footnotes)
    # Writer review threads stay in the collection, outside the Word document.
    assert not list(doc.iter(w + "commentReference"))
    if "word/comments.xml" in package.namelist():
        comments = ET.fromstring(package.read("word/comments.xml"))
        assert not list(comments.iter(w + "comment"))
    parts = {}
    for name in sorted(package.namelist()):
        content = package.read(name)
        if name == "docProps/core.xml":
            root = ET.fromstring(content)
            for node in root:
                if node.tag in (terms + "created", terms + "modified"):
                    node.text = ""
            content = ET.tostring(root)
        parts[name] = hashlib.sha256(content).hexdigest()
    print(json.dumps(parts))
`;

const browser = await chromium.launch({ executablePath: process.env.CHROME });
const inspectDocx = (path) => JSON.parse(execFileSync("python3", ["-c", inspect, path], { encoding: "utf8" }));
try {
  const fixture = new URL(base);
  fixture.search = new URLSearchParams({ demo: "large", largeManuscript: "1", manuscript }).toString();
  let reference = referencePath ? inspectDocx(resolve(referencePath)) : undefined;
  for (let run = 1; run <= runs; run++) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, serviceWorkers: "block" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(120_000);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await page.addInitScript(() => {
      localStorage.setItem("mdbase-writer:layout", JSON.stringify({ view: "write" }));
      window.tasks = [];
      new PerformanceObserver((list) => window.tasks.push(...list.getEntries().map(e => [e.startTime, e.duration])))
        .observe({ type: "longtask" });
    });
    await page.goto(fixture.href);
    await page.waitForFunction(() => {
      const workspace = window.writer?.workspace;
      if (!workspace) return false;
      const snap = workspace.getSnapshot();
      const order = workspace.readingOrder();
      return order.length === 61 && order.every(path => snap.records.has(path))
        && ["indexLoad", "libraryLoad", "annotationsLoad", "commentsLoad"].every(key => snap[key].phase === "ready");
    });
    assert.deepEqual(await page.evaluate(() => {
      const snap = window.writer.workspace.getSnapshot();
      return { comments: snap.comments.length, sources: snap.library.length };
    }), { comments: 300, sources: 5_000 });
    await page.getByRole("tab", { name: "Outline", exact: true }).click();
    await page.locator(`.record-row[data-path="${chapter}"]`).click();
    const editor = page.locator(".cm-content");
    const type = async () => {
      await editor.focus();
      await page.keyboard.press("ControlOrMeta+End");
      for (let i = 0; i < 12; i++) await page.keyboard.insertText(typed);
    };
    await type();
    await page.getByRole("tab", { name: /Comments/ }).click();
    await page.locator(".mdbase-threads > .mdbase-thread").first().waitFor();
    await type();
    await page.waitForFunction(({ chapter, suffix }) => window.writer.workspace.getSnapshot().records.get(chapter).snapshot.body.endsWith(suffix),
      { chapter, suffix: typed.repeat(24) });

    // Save at the export boundary to reproduce the autosave refresh on demand.
    // Both paths use the ordinary SDK record session and collection watch.
    const start = await page.evaluate(chapter => {
      const workspace = window.writer.workspace;
      for (const stage of ["preflight", "materialize"]) {
        const method = workspace[stage].bind(workspace);
        workspace[stage] = async (...args) => {
          performance.mark(`${stage}:start`);
          try { return await method(...args); }
          finally { performance.mark(`${stage}:end`); }
        };
      }
      const exportDocx = workspace.exportDocx.bind(workspace);
      workspace.exportDocx = async (...args) => {
        performance.mark("export:start");
        try { return await exportDocx(...args); }
        finally { performance.mark("export:end"); }
      };
      const start = performance.now();
      window.save = workspace.retrySave(chapter);
      return start;
    }, chapter);

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export formats" }).click();
    await page.getByRole("menuitem").filter({ has: page.getByText("Word (DOCX)", { exact: true }) }).click();
    await page.waitForFunction(() => performance.getEntriesByName("export:end").length === 1);
    const review = page.getByRole("button", { name: "Export anyway", exact: true });
    if (await review.isVisible()) await review.click();
    const file = await download;
    const timing = await page.evaluate(start => {
      const exportStart = performance.getEntriesByName("export:start")[0].startTime;
      const exportEnd = performance.getEntriesByName("export:end")[0].startTime;
      const elapsed = (stage) => performance.measure(stage, `${stage}:start`, `${stage}:end`).duration;
      const preflight = elapsed("preflight");
      const materialize = elapsed("materialize");
      return {
        saveToDownloadMs: Math.round(performance.now() - start),
        beforeExportMs: Math.round(exportStart - start),
        exportMs: Math.round(exportEnd - exportStart),
        preflightMs: Math.round(preflight),
        materializeMs: Math.round(materialize - preflight),
        convertAndFetchMs: Math.round(exportEnd - exportStart - materialize),
        mainLongTaskMs: Math.round(window.tasks.filter(([at]) => at >= start).reduce((sum, [, duration]) => sum + duration, 0)),
      };
    }, start);
    assert.equal((await page.evaluate(() => window.save)).ok, true);
    assert.deepEqual(errors, []);
    const path = resolve(output, `run-${run}.docx`);
    await file.saveAs(path);
    const parts = inspectDocx(path);
    if (reference) assert.deepEqual(parts, reference);
    reference = parts;
    console.log(JSON.stringify({ run, ...timing, parts }));
    await page.context().close();
  }
} finally {
  await browser.close();
}
