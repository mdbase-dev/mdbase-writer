import { afterEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  init: vi.fn(async () => {}), addSource: vi.fn(), mapShadow: vi.fn(),
}));
vi.mock("@myriaddreamin/typst.ts/compiler", () => ({ createTypstCompiler: () => mock }));
vi.mock("@myriaddreamin/typst.ts/options.init", () => ({ disableDefaultFontAssets: () => {}, loadFonts: () => {} }));
vi.mock("../async.js", () => ({ fetchChecked: vi.fn(async () => new Response(new Uint8Array([1]))) }));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules(); });
it("prepares once without compiling or announcing readiness before the input snapshot", async () => {
  const worker = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined, postMessage: vi.fn() };
  vi.stubGlobal("self", worker);
  await import("./worker.js");
  worker.onmessage!({ data: { type: "prepare", baseUrl: "/" } });
  worker.onmessage!({ data: { type: "prepare", baseUrl: "/" } });
  await vi.waitFor(() => expect(mock.addSource).toHaveBeenCalled());
  expect(mock.init).toHaveBeenCalledTimes(1);
  expect(worker.postMessage).not.toHaveBeenCalled();
  worker.onmessage!({ data: { type: "init", baseUrl: "/", library: [], styles: [], locales: [] } });
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ready" }), []));
  expect(mock.init).toHaveBeenCalledTimes(1);
});
it("reports preparation failures rather than leaving readiness pending", async () => {
  const worker = { onmessage: undefined as ((event: { data: unknown }) => void) | undefined, postMessage: vi.fn() };
  mock.init.mockRejectedValueOnce(new Error("compiler unavailable"));
  vi.stubGlobal("self", worker);
  await import("./worker.js");
  worker.onmessage!({ data: { type: "prepare", baseUrl: "/" } });
  await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith({ type: "failure", message: "compiler unavailable" }, []));
});
