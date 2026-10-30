// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import { render } from "../test/render.js";
import { useCallback } from "react";
import { connect, type MdbaseClient } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextWriterRecords } from "../backend/next-records.js";
import type { RecordView } from "../workspace/workspace.js";
import { OutlinePanel } from "./OutlinePanel.js";

const reveals = vi.hoisted(() => vi.fn());
vi.mock("./paging.js", async importOriginal => {
  const original = await importOriginal<typeof import("./paging.js")>();
  return { useRowWindow(initial?: number) {
    const { reveal, ...window } = original.useRowWindow(initial);
    const tracked = useCallback((rank: number) => { reveals(rank); reveal(rank); }, [reveal]);
    return { ...window, reveal: tracked };
  } };
});
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeEach(() => Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value() {} }));
const clients: MdbaseClient[] = [];
afterEach(() => { cleanup(); reveals.mockClear(); for (const client of clients.splice(0)) client.close(); });

async function fixture(body: string) {
  const replica = new MemoryReplica({ confirmDelayMs: 0 });
  replica.seed({ path: "main.md", body, frontmatter: { title: "Document" } });
  const client = await connect({ connector: replica.connector(), app: { name: "writer-outline-test", version: "test" }, reconnect: false });
  clients.push(client);
  const opened = await new NextWriterRecords(client, new AbortController().signal).open("main.md", { autosave: false });
  if (!opened.ok) throw new Error(opened.problem.code);
  const { session, release } = opened.value;
  const props = { main: "main.md", order: ["main.md"], chapters: [], words: 100, byRecord: new Map(), active: "main.md", onOpen: vi.fn(), onJump: vi.fn(), onMove: vi.fn(), onAdd: vi.fn() };
  const panel = (offset: number) => {
    const view: RecordView = { path: "main.md", snapshot: session.getSnapshot() };
    return <OutlinePanel {...props} records={new Map([[view.path, view]])} cursor={{ record: view.path, offset }} />;
  };
  return { session, release, panel };
}

it("does not request the same heading window again when typing reparses its rows", async () => {
  const body = "# Document\n\n## First\n\nText\n\n## Second\n\nMore text\n";
  const h = await fixture(body);
  try {
    const rendered = render(h.panel(body.indexOf("Text")));
    reveals.mockClear();
    for (let i = 0; i < 5; i++) {
      act(() => h.session.setBody(body.replace("Text", `Text ${"more ".repeat(i + 1)}`)));
      rendered.rerender(h.panel(body.indexOf("Text") + i));
    }
    expect(reveals).not.toHaveBeenCalled();
  } finally { h.release(); }
});

it("still reveals a different logical heading beyond the first page", async () => {
  const body = Array.from({ length: 65 }, (_, i) => `## Section ${i}\n\nText\n`).join("\n");
  const h = await fixture(body);
  try {
    const rendered = render(h.panel(0));
    const at = body.indexOf("## Section 55\n");
    expect(rendered.container.querySelector(`[data-heading="${at}"]`)).toBeNull();
    rendered.rerender(h.panel(at));
    expect(reveals).toHaveBeenCalledWith(55);
    expect(rendered.container.querySelector(`[data-heading="${at}"]`)).not.toBeNull();
  } finally { h.release(); }
});

afterEach(() => {
  if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoView);
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});
