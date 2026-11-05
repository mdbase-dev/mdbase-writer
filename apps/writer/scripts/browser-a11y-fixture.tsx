// Native browser fixtures never contact Connect or real accounts.
import { createRoot } from "react-dom/client";
import type { Mdbase } from "@mdbase-dev/sdk";
import { App } from "../src/App.js";
import { AppI18nProvider } from "../src/i18n/provider.js";
import { createTestApp } from "@mdbase-dev/sdk/testing";
import manifest from "../src/generated/mdbase-app.json";

export function mountSignIn() {
  document.getElementById("root")!.hidden = true;
  const host = document.createElement("div");
  document.body.append(host);
  const snapshot = { status: "signed_out", phase: { kind: "signed_out" }, collections: [], signIn: null };
  const sdk = { getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as Mdbase;
  const root = createRoot(host);
  root.render(<AppI18nProvider><App sdk={sdk} /></AppI18nProvider>);
}

export async function mountNative() {
  const names = ["manuscript", "source", "comment"];
  const fixture = await createTestApp({
    declaration: { id: "writer.polish", name: "Writer polish", origin: "https://writer.mdbase.dev", environment: "lab", manifest },
    collections: [{ name: "Writing", contracts: manifest.requirements.contracts.map((contract, index) => ({
      id: contract.id, version: contract.version, contractDigest: contract.digest, type: names[index]!, fields: { title: "title", template: "template", csl: "csl" },
    })), records: [{ path: "writing/main.md", types: ["manuscript"], frontmatter: { title: "Original manuscript" }, body: "# Original manuscript\n\nConfirmed native text.\n" }] }],
    phase: "ready",
  });
  fixture.client().describe = async () => ({
    specVersion: "0.3.0", settings: new Map(), issues: [], inclusion: { include: ["image"] },
    contracts: manifest.requirements.contracts.map((contract, index) => ({ ...contract, path: `_contracts/${contract.id}.md`, digest: contract.digest.replace(/^sha256:/, ""), contractType: "record", implementedBy: [names[index]!] })),
    types: manifest.requirements.contracts.map((contract, index) => ({ name: names[index]!, path: `_types/${names[index]}.md`, implements: [{ contract: contract.id, version: contract.version, fields: new Map([["title", "title"], ["template", "template"], ["csl", "csl"]]) }] })),
  });
  document.getElementById("root")!.hidden = true;
  const host = document.createElement("div");
  host.style.height = "100%";
  document.body.append(host);
  const root = createRoot(host);
  root.render(<AppI18nProvider><App sdk={fixture.mdbase} /></AppI18nProvider>);
  return { ...fixture, close: async () => { root.unmount(); host.remove(); await fixture.close(); } };
}
