/// <reference lib="webworker" />
// The compile worker owns manuscript assembly (translation, citeproc) and the
// Typst WASM compiler, so typing never waits on either. Changes coalesce:
// while a compile runs, later messages only update state, and the next
// compile uses the newest of everything.
import { createTypstCompiler, type TypstCompiler } from "@myriaddreamin/typst.ts/compiler";
import { disableDefaultFontAssets, loadFonts } from "@myriaddreamin/typst.ts/options.init";
import compilerPackage from "@myriaddreamin/typst-ts-web-compiler/package.json";
import {
  MAIN,
  ManuscriptAssembler,
  mapToRecord,
  typstPositionToOffset,
  typstString,
  type Assembly,
  type CslItem,
  type WriterRecord,
} from "@mdbase-writer/core";

import type { BlockPosition, CompileResult, FromWorker, ToWorker, WriterDiagnostic } from "./protocol.js";

declare const self: DedicatedWorkerGlobalScope;

const runtime = import.meta.glob("../../typst/**/*.typ", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const FONTS = ["LibertinusSerif-Regular.otf", "LibertinusSerif-Italic.otf", "LibertinusSerif-Bold.otf", "LibertinusSerif-BoldItalic.otf", "NewCMMath-Regular.otf", "DejaVuSansMono.ttf"];
const MITEX = ["lib.typ", "mitex.typ", "mitex.wasm", "specs/mod.typ", "specs/prelude.typ", "specs/latex/standard.typ"];
/** Shown for an image until its bytes arrive. */
const PENDING_IMAGE = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="120"/>');

/**
 * The compiler module is 28 MB, over Cloudflare Pages' 25 MiB file limit, so
 * deployed builds fetch it from functions/wasm (backed by R2) under a
 * versioned name. Development serves it straight from node_modules.
 */
async function compilerUrl(baseUrl: string): Promise<string> {
  if (import.meta.env.DEV) {
    return (await import("@myriaddreamin/typst-ts-web-compiler/pkg/typst_ts_web_compiler_bg.wasm?url")).default;
  }
  return `${baseUrl}wasm/typst_ts_web_compiler-${compilerPackage.version}.wasm`;
}

let compiler: TypstCompiler | undefined;
const assembler = new ManuscriptAssembler();
let library = new Map<string, CslItem>();
let styles = new Map<string, string>();
let locales = new Map<string, string>();
/** Collection text files the settings name (a .csl style, a .typ template), decoded. */
const texts = new Map<string, string>();
const records = new Map<string, WriterRecord>();
let recordPaths = new Set<string>();
let filePaths = new Set<string>();
let main = "";
const loadedAssets = new Set<string>();
const requestedAssets = new Set<string>();
const pushed = new Map<string, string>();
let revision = 0;
let dirty = false;
let busy = false;
const pdfRequests: number[] = [];

const post = (message: FromWorker, transfer: Transferable[] = []) => self.postMessage(message, transfer);
const bytes = async (url: string) => new Uint8Array(await (await fetch(url)).arrayBuffer());

async function init(message: Extract<ToWorker, { type: "init" }>) {
  const started = performance.now();
  library = new Map(message.library.map((i) => [i.id, i]));
  styles = new Map(message.styles);
  locales = new Map(message.locales);
  const [fonts, mitex] = await Promise.all([
    Promise.all(FONTS.map((f) => bytes(`${message.baseUrl}fonts/${f}`))),
    Promise.all(MITEX.map((f) => bytes(`${message.baseUrl}typst/mitex/${f}`))),
  ]);
  const c = createTypstCompiler();
  const wasmUrl = await compilerUrl(message.baseUrl);
  await c.init({ getModule: () => fetch(wasmUrl), beforeBuild: [disableDefaultFontAssets(), loadFonts(fonts)] });
  MITEX.forEach((f, i) => c.mapShadow(`/vendor/mitex/${f}`, mitex[i] ?? new Uint8Array()));
  for (const [path, source] of Object.entries(runtime)) c.addSource(path.replace(/^\.\.\/\.\.\/typst/, ""), source);
  compiler = c;
  post({ type: "ready", initMs: performance.now() - started });
  schedule();
}

function schedule() {
  dirty = true;
  void drain();
}

// A WASM compile blocks this thread, so messages sent meanwhile sit in the
// queue. Yielding before each compile lets them land first and coalesce.
const yieldToQueue = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function drain() {
  if (busy || !compiler) return;
  busy = true;
  try {
    await yieldToQueue();
    while (dirty || pdfRequests.length) {
      if (dirty && main && records.has(main)) {
        dirty = false;
        const result = await compile(compiler);
        post(result, result.artifact ? [result.artifact.buffer] : []);
      } else dirty = false;
      while (pdfRequests.length) {
        const id = pdfRequests.shift() as number;
        await exportPdf(compiler, id);
      }
      await yieldToQueue();
    }
  } catch (e) {
    post({ type: "failure", message: e instanceof Error ? e.message : String(e) });
  } finally {
    busy = false;
  }
}

interface TypstDiagnostic {
  readonly path: string;
  readonly range: string;
  readonly severity: string;
  readonly message: string;
}

async function compile(c: TypstCompiler): Promise<CompileResult> {
  const started = performance.now();
  const assembly = assembler.assemble({ main, records, recordPaths, filePaths, library, styles, locales, texts });
  const assembled = performance.now();

  const neededAssets = assembly.assets.filter((a) => !loadedAssets.has(a));
  for (const asset of neededAssets) {
    if (!requestedAssets.has(asset)) {
      requestedAssets.add(asset);
      c.mapShadow(`/${asset}`, PENDING_IMAGE);
    }
  }
  pushSources(c, assembly.sources);

  let outcome = await typeset(c);
  // An error inside a raw Typst block can swallow the rest of its file (an
  // unclosed parenthesis). Replace just the offending blocks and try again.
  const broken = brokenRawBlocks(assembly, outcome.diagnostics);
  if (broken.size) {
    const patched = new Map(assembly.sources);
    for (const [path, blocks] of broken) {
      let src = patched.get(path) ?? "";
      for (const [from, to, message] of [...blocks].sort((a, b) => b[0] - a[0])) {
        src = `${src.slice(0, from)}#broken-block(${typstString(message)})${src.slice(to)}`;
      }
      patched.set(path, src);
    }
    pushSources(c, patched);
    const retry = await typeset(c);
    outcome = { ...retry, diagnostics: [...outcome.diagnostics.filter((d) => broken.has(d.path)), ...retry.diagnostics] };
  }

  const diagnostics: WriterDiagnostic[] = [
    ...assembly.diagnostics.map((d) => ({ ...d, origin: "writer" as const })),
    ...outcome.diagnostics.flatMap((d) => mapTypstDiagnostic(d, assembly)),
  ];
  return {
    type: "result",
    revision: ++revision,
    ...(outcome.artifact ? { artifact: outcome.artifact } : {}),
    diagnostics: dedupe(diagnostics),
    positions: outcome.positions,
    meta: assembly.meta,
    order: assembly.order,
    unloaded: assembly.unloaded,
    neededAssets,
    labels: [...assembly.labels],
    timings: {
      assembleMs: assembled - started,
      compileMs: performance.now() - assembled,
      citations: assembly.citations.mode,
      clusters: assembly.citations.clusters,
    },
  };
}

function pushSources(c: TypstCompiler, sources: ReadonlyMap<string, string>) {
  for (const [path, source] of sources) {
    if (pushed.get(path) !== source) {
      c.addSource(path, source);
      pushed.set(path, source);
    }
  }
}

async function typeset(c: TypstCompiler): Promise<{ artifact?: Uint8Array; diagnostics: TypstDiagnostic[]; positions: BlockPosition[] }> {
  return c.runWithWorld({ mainFilePath: MAIN }, async (world) => {
    const compiled = await world.compile({ diagnostics: "full" });
    const diagnostics = ((compiled.diagnostics ?? []) as TypstDiagnostic[]).filter((d) => d.severity === "error" || d.severity === "warning");
    if (compiled.hasError) return { diagnostics, positions: [] };
    // typst.ts 0.7.0 returns no result for diagnostics: "none"; always ask for "full".
    const vector = await world.vector({ diagnostics: "full" });
    let positions: BlockPosition[] = [];
    try {
      const q = (await world.query({ selector: "<md-pos>", field: "value" })) as [[[string, number], { page: number; y: string }][]];
      positions = (q[0] ?? []).map(([[record, offset], p]) => ({ record, offset, page: p.page, y: Number.parseFloat(p.y) }));
    } catch {
      // Positions only power click-to-source; a failed query leaves them empty.
    }
    return { ...(vector.result ? { artifact: vector.result } : {}), diagnostics, positions };
  });
}

/** Raw blocks (per Typst file) containing an error, with the message to show in their place. */
function brokenRawBlocks(assembly: Assembly, diagnostics: readonly TypstDiagnostic[]): Map<string, [number, number, string][]> {
  const broken = new Map<string, [number, number, string][]>();
  for (const d of diagnostics) {
    if (d.severity !== "error") continue;
    const blocks = assembly.rawBlocks.get(d.path);
    const src = assembly.sources.get(d.path);
    const m = /^(\d+):(\d+)/.exec(d.range);
    if (!blocks?.length || src === undefined || !m) continue;
    const offset = typstPositionToOffset(src, Number(m[1]), Number(m[2]));
    const block = blocks.find(([from, to]) => offset >= from && offset <= to);
    if (!block) continue;
    const list = broken.get(d.path) ?? [];
    if (!list.some(([from]) => from === block[0])) list.push([block[0], block[1], d.message]);
    broken.set(d.path, list);
  }
  return broken;
}

function mapTypstDiagnostic(d: TypstDiagnostic, assembly: Assembly): WriterDiagnostic[] {
  const map = assembly.maps.get(d.path);
  const src = assembly.sources.get(d.path);
  const m = /^(\d+):(\d+)/.exec(d.range);
  const severity = d.severity === "warning" ? "warning" : "error";
  if (!map || src === undefined || !m) {
    // Problems in the generated main file or a template belong to the
    // manuscript's settings: the line of the main file says which one.
    const line = m ? Number(m[1]) - 1 : -1;
    const field = d.path === MAIN ? assembly.mainFields.get(line) : d.path.startsWith("/templates/") || d.path === `/${assembly.meta.template}` ? "template" : undefined;
    return [{ record: main, from: 0, to: 0, severity, message: `Typst: ${d.message}`, origin: "typst", ...(field ? { field } : {}) }];
  }
  const from = mapToRecord(map, typstPositionToOffset(src, Number(m[1]), Number(m[2])));
  return [{ record: map.record, from, to: from, severity, message: `Typst: ${d.message}`, origin: "typst" }];
}

function dedupe(list: WriterDiagnostic[]): WriterDiagnostic[] {
  const seen = new Set<string>();
  return list.filter((d) => {
    const key = `${d.record}:${d.from}:${d.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function exportPdf(c: TypstCompiler, id: number) {
  try {
    const out = await c.runWithWorld({ mainFilePath: MAIN }, async (world) => {
      const compiled = await world.compile({ diagnostics: "full" });
      if (compiled.hasError) return undefined;
      return (await world.pdf({ diagnostics: "full" })).result;
    });
    if (out) post({ type: "pdf", id, bytes: out }, [out.buffer]);
    else post({ type: "pdf", id, error: "The document has errors; fix them to export." });
  } catch (e) {
    post({ type: "pdf", id, error: e instanceof Error ? e.message : String(e) });
  }
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      void init(message);
      return;
    case "library":
      library = new Map(message.library.map((i) => [i.id, i]));
      break;
    case "collection":
      recordPaths = new Set(message.recordPaths);
      filePaths = new Set(message.filePaths);
      break;
    case "records":
      for (const r of message.upsert) records.set(r.path, r);
      for (const p of message.remove ?? []) records.delete(p);
      break;
    case "main":
      main = message.path;
      break;
    case "assets":
      for (const [path, data] of message.files) {
        if (/\.(csl|typ)$/i.test(path)) texts.set(path, new TextDecoder().decode(data));
        compiler?.mapShadow(`/${path}`, data);
        loadedAssets.add(path);
      }
      break;
    case "export-pdf":
      pdfRequests.push(message.id);
      void drain();
      return;
  }
  schedule();
};

