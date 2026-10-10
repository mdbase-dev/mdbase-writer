import { connect, MdbaseError, type MdbaseClient } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextWriterRecords, type NextWriterLease } from "./next-records.js";

const clients: MdbaseClient[] = [];
const leases: NextWriterLease[] = [];
afterEach(() => {
  for (const lease of leases.splice(0)) lease.release();
  for (const client of clients.splice(0)) client.close();
  vi.restoreAllMocks();
});

async function fixture(pending = false) {
  const replica = new MemoryReplica({ confirmDelayMs: pending ? null : 0 });
  const record = replica.seed({ path: "writing/draft.md", frontmatter: { title: "Draft", custom: "preserve" }, body: "Original body\n" });
  const client = await connect({ connector: replica.connector(), app: { name: "writer-lease-test", version: "test" }, reconnect: false });
  clients.push(client);
  const owner = new AbortController();
  // The public helper is frozen; a typed test-only forwarding port observes
  // real SDK calls without modifying the native lease/session engine.
  const nativeOpen = vi.fn(client.records.open.bind(client.records));
  return { replica, record, client, owner, nativeOpen, records: new NextWriterRecords({ records: { open: nativeOpen } }, owner.signal) };
}

async function open(f: Awaited<ReturnType<typeof fixture>>): Promise<NextWriterLease> {
  const result = await f.records.open(f.record.path, { autosave: false });
  if (!result.ok) throw new Error(result.problem.message);
  leases.push(result.value);
  return result.value;
}

describe("NextWriterRecords SDK lease value translation (stand-in, not native/runtime)", () => {
  it("opens an explicit native path and projects display JSON without replacing the native view", async () => {
    const f = await fixture();
    const nativeOpen = f.nativeOpen;
    const lease = await open(f);
    expect(nativeOpen).toHaveBeenCalledWith({ path: f.record.path }, { autosave: false, signal: f.owner.signal });
    expect(lease.session.getSnapshot()).toMatchObject({ state: "saved", body: "Original body\n", dirty: false, frontmatter: { title: "Draft", custom: "preserve" } });
    const native = lease.session.getNativeSnapshot();
    expect(native.record.id).toBe(f.record.id);
    expect(native.record.frontmatter).toBeInstanceOf(Map);
    expect(native.record.document).toBeDefined();
  });

  it("delegates body/explicit frontmatter patch and confirmed saved state to SDK flush", async () => {
    const f = await fixture();
    const lease = await open(f);
    const changed = vi.fn();
    const stop = lease.session.subscribe(changed);
    lease.session.setBody("Changed body\n");
    lease.session.patchFrontmatter({ title: "Renamed", options: { style: "plain" } });
    expect(lease.session.getSnapshot()).toMatchObject({ state: "unsaved", body: "Changed body\n", dirty: true, frontmatter: { title: "Renamed", custom: "preserve", options: { style: "plain" } } });
    expect(await lease.session.flush({ timeoutMs: 1000 })).toEqual({ ok: true });
    expect(lease.session.getSnapshot()).toMatchObject({ state: "saved", body: "Changed body\n", dirty: false });
    expect(lease.session.getNativeSnapshot().lastReceipt?.state).toBe("confirmed");
    expect((await f.client.get(f.record.id, { body: true })).body).toBe("Changed body\n");
    expect(changed).toHaveBeenCalled();
    stop();
  });

  it("keeps the SDK-owned shared session alive after one peer releases", async () => {
    const f = await fixture();
    const first = await open(f);
    const second = await open(f);
    first.session.setBody("Shared peer draft\n");
    expect(second.session.getSnapshot().body).toBe("Shared peer draft\n");
    first.release();
    expect(await second.session.flush({ timeoutMs: 1000 })).toEqual({ ok: true });
    expect((await f.client.get(f.record.id, { body: true })).body).toBe("Shared peer draft\n");
  });

  it("passes retained recovery identity to the native open helper without a factory shim", async () => {
    const f = await fixture();
    const nativeLease = await f.client.records.open({ path: f.record.path }, { autosave: false });
    // Observe delegation only; a made-up recovery ref is not native proof.
    const release = vi.fn(() => nativeLease.release());
    const nativeOpen = f.nativeOpen.mockResolvedValue({ session: nativeLease.session, release });
    const recovery = { mutationId: crypto.randomUUID(), recordId: f.record.id, baseRevision: nativeLease.session.getSnapshot().record.revision };
    const result = await f.records.open(f.record.path, { autosave: false, recovery });
    expect(nativeOpen).toHaveBeenCalledWith({ path: f.record.path }, { autosave: false, recovery, signal: f.owner.signal });
    expect(result.ok).toBe(true);
    if (result.ok) { result.value.release(); }
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("translates real SDK open errors without changing their code/message", async () => {
    const f = await fixture();
    const problem = { code: "not_found" as const, recovery: "fix_request" as const, message: "Missing native record" };
    f.nativeOpen.mockRejectedValue(new MdbaseError(problem));
    expect(await f.records.open("missing.md")).toEqual({ ok: false, problem });
  });

  it("does not invoke native open after the owner has aborted", async () => {
    const f = await fixture();
    f.owner.abort(new Error("Writer closed"));
    const nativeOpen = f.nativeOpen;
    expect(await f.records.open(f.record.path)).toEqual({ ok: false, problem: { code: "cancelled", message: "Writer closed" } });
    expect(nativeOpen).not.toHaveBeenCalled();
  });

  it("releases a late-delivered lease after owner cancellation without closing the borrowed client", async () => {
    const f = await fixture();
    const nativeLease = await f.client.records.open({ path: f.record.path }, { autosave: false });
    const release = vi.fn(() => nativeLease.release());
    f.nativeOpen.mockImplementation(() => {
      f.owner.abort(new Error("Writer closed"));
      return Promise.resolve({ session: nativeLease.session, release });
    });
    const close = vi.spyOn(f.client, "close");
    expect(await f.records.open(f.record.path)).toEqual({ ok: false, problem: { code: "cancelled", message: "Writer closed" } });
    expect(release).toHaveBeenCalledTimes(1);
    expect(close).not.toHaveBeenCalled();
  });

  it("fences a late successful flush result with the original owner signal", async () => {
    const f = await fixture();
    const nativeLease = await f.client.records.open({ path: f.record.path }, { autosave: false });
    const nativeFlush = vi.fn(async () => {
      f.owner.abort(new Error("Writer closed during delivery"));
      return { ok: true as const, record: nativeLease.session.getSnapshot().record };
    });
    f.nativeOpen.mockResolvedValue({
      session: { ...nativeLease.session, flush: nativeFlush },
      release: () => nativeLease.release(),
    });
    const lease = await open(f);
    expect(await lease.session.flush({ timeoutMs: 100 })).toEqual({ ok: false, problem: { code: "cancelled", message: "Writer closed during delivery" } });
    expect(nativeFlush).toHaveBeenCalledWith({ timeoutMs: 100, signal: f.owner.signal });
    expect(lease.session.getNativeSnapshot().record.id).toBe(f.record.id);
  });

  it("validates the entire explicit JSON patch before changing the SDK draft", async () => {
    const f = await fixture();
    const lease = await open(f);
    for (const invalid of [NaN, Infinity, new Date(), 1n]) {
      expect(() => lease.session.patchFrontmatter({ title: "Must not change", bad: invalid })).toThrow("plain JSON values");
      expect(lease.session.getSnapshot()).toMatchObject({ state: "saved", dirty: false, frontmatter: { title: "Draft" } });
    }
    lease.session.patchFrontmatter({ custom: undefined });
    expect(lease.session.getNativeSnapshot().frontmatter.has("custom")).toBe(false);
    expect((await f.client.pendingWrites())).toEqual([]);
  });

  it("keeps native mutation/recovery evidence when confirmation is not yet available", async () => {
    const f = await fixture(true);
    const lease = await open(f);
    const update = vi.spyOn(f.client, "update");
    lease.session.setBody("Pending draft\n");
    const result = await lease.session.flush({ timeoutMs: 25 });
    expect(result.ok).toBe(false);
    expect(lease.session.getSnapshot().body).toBe("Pending draft\n");
    const pending = await f.client.pendingWrites();
    expect(pending).toHaveLength(1);
    const mid = pending[0]!.receipt.mutation;
    expect(update).toHaveBeenCalledTimes(1);
    const recovery = lease.session.getNativeSnapshot().recovery;
    expect(recovery?.mutationId).toBe(mid);
    expect(recovery?.recordId).toBe(f.record.id);
    f.replica.confirmAll();
    expect(await lease.session.flush({ timeoutMs: 1000 })).toEqual({ ok: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(lease.session.getNativeSnapshot().lastReceipt?.mutation).toBe(mid);
  });
});
