import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CompileClient } from "./client.js";

class FakeWorker {
  static latest: FakeWorker;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { message: string; preventDefault(): void }) => void;
  onmessageerror?: () => void;
  posts: unknown[] = [];
  terminated = false;
  constructor() { FakeWorker.latest = this; }
  postMessage(message: unknown) { this.posts.push(message); }
  terminate() { this.terminated = true; }
  reply(data: unknown) { this.onmessage?.({ data }); }
}
beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("Worker", FakeWorker); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("prepares independently without starting a compile timeout", async () => {
  const client = new CompileClient();
  client.send({ type: "prepare", baseUrl: "/" });
  FakeWorker.latest.reply({ type: "ready", initMs: 1 });
  await client.ready;
  const failure = vi.fn(); client.onFailure(failure);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(failure).not.toHaveBeenCalled();
  client.terminate();
});
it("settles readiness and all outstanding exports when the worker fails", async () => {
  const client = new CompileClient();
  const failed = vi.fn(); client.onFailure(failed);
  const one = client.exportPdf(), two = client.exportPdf();
  FakeWorker.latest.onerror?.({ message: "Worker crashed", preventDefault() {} });
  await expect(client.ready).rejects.toThrow("Worker crashed");
  expect(await one).toEqual({ error: "Worker crashed" });
  expect(await two).toEqual({ error: "Worker crashed" });
  expect(failed).toHaveBeenCalledWith("Worker crashed");
  expect(FakeWorker.latest.terminated).toBe(true);
});
it("settles exports on disposal", async () => {
  const client = new CompileClient();
  const pending = client.exportPdf();
  client.terminate();
  expect(await pending).toEqual({ error: "The manuscript was closed." });
});
it("allows cancelling one PDF request without killing live typesetting", async () => {
  const client = new CompileClient();
  const abort = new AbortController();
  const pending = client.exportPdf([["/__main__.typ", "frozen source"]], abort.signal);
  abort.abort();
  expect(await pending).toEqual({ error: "Export cancelled." });
  expect(FakeWorker.latest.terminated).toBe(false);
  expect(FakeWorker.latest.posts[0]).toMatchObject({ sources: [["/__main__.typ", "frozen source"]] });
  client.terminate();
});
it("times out initialization and a stuck compile rather than waiting forever", async () => {
  const client = new CompileClient();
  FakeWorker.latest.reply({ type: "ready", initMs: 1 });
  await client.ready;
  const failed = vi.fn(); client.onFailure(failed);
  client.send({ type: "main", path: "main.md" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(failed).toHaveBeenCalledWith(expect.stringContaining("Typesetting took too long"));
  const second = new CompileClient();
  await vi.advanceTimersByTimeAsync(60_000);
  await expect(second.ready).rejects.toThrow("too long to load");
});
