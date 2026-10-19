import { isMdbaseError, mdbaseError } from "@mdbase-dev/sdk";
import { describe, expect, it, vi } from "vitest";

import { problemFrom } from "../backend/next-errors.js";
import { nextStatusText } from "../ui/next-status.js";
import { proposedControlPlane, routeFromResponse } from "./next-control.js";

const key = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
const device = "0192f3a0-0000-7000-8000-000000000001";

describe("proposed control-plane route", () => {
  it("uses the first well-formed target", () => {
    const route = routeFromResponse({ targets: [{ url: "wss://relay.example/x" }, { url: "wss://relay.example/s/1", device, noise_pk: key }] });
    expect(route).toMatchObject({ url: "wss://relay.example/s/1", targetDevice: device });
    expect(route?.noisePublicKey).toEqual(new Uint8Array(32).fill(7));
  });

  it("reads no targets as no device online", () => {
    expect(routeFromResponse({ targets: [] })).toBeNull();
    expect(() => routeFromResponse({})).toThrow();
  });

  it("calls the proposed endpoint and maps HTTP failures to SDK codes", async () => {
    const fetch = vi.fn(async () => Response.json({ targets: [{ url: "wss://relay.example/s/1", device, noise_pk: key.replace(/=+$/, "") }] }));
    const control = proposedControlPlane({ serverUrl: "https://connect.example", grant: "g", fetch });
    expect(await control.grant("c", new Uint8Array(32))).toBe("g");
    expect((await control.route("c 1"))?.targetDevice).toBe(device);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("https://connect.example/v1/next/collections/c%201/route");
    for (const [status, code] of [[401, "unauthenticated"], [403, "forbidden"], [503, "unavailable"]] as const) {
      const failing = proposedControlPlane({ serverUrl: "https://connect.example", grant: null, fetch: async () => new Response(null, { status }) });
      const error = await failing.route("c").catch((e: unknown) => e);
      expect(isMdbaseError(error, code)).toBe(true);
    }
  });
});

describe("mdbase-next status line", () => {
  const status = { mode: "synced" as const, confirmedThrough: 4, headKnown: 4, pending: 0, holds: 0, unresolved: 0, connection: "online" as const, incidents: [] };
  it("says nothing while everything is synced", () => {
    expect(nextStatusText({ link: "open", problem: null, status, holds: 0 })).toBeNull();
  });
  it("shows waiting for a device, pending changes and holds", () => {
    const waiting = problemFrom(mdbaseError("unavailable", "x", "no_device_online"));
    expect(nextStatusText({ link: "reconnecting", problem: waiting, status, holds: 0 })).toMatch(/Waiting for one of your devices/);
    expect(nextStatusText({ link: "open", problem: null, status: { ...status, connection: "offline", pending: 2 }, holds: 1 }))
      .toBe("2 changes are saved on the replica and waiting to sync; 1 record needs a decision.");
  });
});
