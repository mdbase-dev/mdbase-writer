// The `?demo=next` collection: the bundled demo manuscripts on the SDK's
// in-memory replica, read and written through NextBackend. No account, relay
// or device. Writes stay pending for a moment before they confirm, as they
// would on a real replica.
import { connect, toValue, type MdbaseClient, type PlainValue } from "@mdbase-dev/sdk";
import { MemoryReplica } from "@mdbase-dev/sdk/testing";
import type { CslItem } from "@mdbase-writer/core";
import { splitFrontmatter } from "@mdbase-writer/core/records";

import { WRITER_CLIENT } from "../connect/next-control.js";
import { NextBackend } from "./next.js";

const markdown = import.meta.glob("../../demo/**/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const assets = import.meta.glob("../../demo/**/*.{svg,png,jpg}", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const relative = (key: string) => key.replace(/^\.\.\/\.\.\/demo\//, "");

const values = (frontmatter: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(frontmatter).map(([key, value]) => [key, toValue(value as PlainValue)]));

function typesOf(frontmatter: Record<string, unknown>): string[] {
  const type = frontmatter["type"];
  return Array.isArray(type) ? type.filter((t): t is string => typeof t === "string") : typeof type === "string" ? [type] : [];
}

export interface NextDemoBackend extends NextBackend {
  /** The in-memory replica, for poking at from the console. */
  readonly replica: MemoryReplica;
  /** Another client on the same replica, to make concurrent edits. */
  otherClient(): Promise<MdbaseClient>;
}

export async function createNextDemoBackend(): Promise<NextDemoBackend> {
  const replica = new MemoryReplica({ confirmDelayMs: 400 });
  for (const [key, text] of Object.entries(markdown)) {
    const { body, frontmatter } = splitFrontmatter(text);
    replica.seed({ path: relative(key), types: typesOf(frontmatter), frontmatter: values(frontmatter), body });
  }
  const library = (await import("../../demo/library.json")).default as CslItem[];
  for (const item of library) {
    replica.seed({ path: `sources/${item.id}.md`, types: ["reader-source"], frontmatter: values({ type: "reader-source", csl: item }), body: "" });
  }
  const client = await connect({ app: WRITER_CLIENT, connector: replica.connector() });
  await Promise.all(Object.entries(assets).map(async ([key, url]) => {
    try {
      const response = await fetch(url);
      if (response.ok) await client.files.upload(relative(key), new Uint8Array(await response.arrayBuffer()));
    } catch { /* A missing figure shows as a diagnostic, as in the other demos. */ }
  }));
  const backend = new NextBackend(client, { collectionName: "Demo collection (mdbase-next)", draftNamespace: "next-demo", ownsClient: true });
  return Object.assign(backend, {
    replica,
    otherClient: () => connect({ app: { ...WRITER_CLIENT, name: "mdbase-writer-demo-peer" }, connector: replica.connector() }),
  });
}
