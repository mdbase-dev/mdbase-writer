// Native browser fixtures never contact Connect or real accounts.
import { createRoot } from "react-dom/client";
import type { Mdbase } from "@mdbase-dev/sdk";
import { App } from "../src/App.js";
import { AppI18nProvider } from "../src/i18n/provider.js";
import { createTestApp } from "@mdbase-dev/sdk/testing";
import manifest from "../src/generated/mdbase-app.json";
import { EditorView } from "@codemirror/view";

export function editorSnapshot() {
  const view = EditorView.findFromDOM(document.querySelector<HTMLElement>(".cm-editor")!)!;
  const { from, to, head } = view.state.selection.main;
  return { from, to, head, text: view.state.doc.toString(), selected: view.state.sliceDoc(from, to) };
}

export function mountSignIn() {
  document.getElementById("root")!.hidden = true;
  const host = document.createElement("div");
  document.body.append(host);
  const snapshot = { status: "signed_out", phase: { kind: "signed_out" }, collections: [], signIn: null };
  const sdk = { getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as Mdbase;
  const root = createRoot(host);
  root.render(<AppI18nProvider><App sdk={sdk} /></AppI18nProvider>);
}

export async function mountCollectionLimit() {
  const fixture = await createTestApp({
    declaration: { id: "writer.limit", name: "Writer limit", origin: "https://lab.mdbase-writer.pages.dev", environment: "lab", manifest },
    collections: [{ name: "Drafts" }],
    phase: "choosing",
  });
  let snapshot = { ...fixture.mdbase.getSnapshot(), links: { account: "https://connect-lab.mdbase.dev/account", manageAccess: "https://connect-lab.mdbase.dev/account/access" } };
  const listeners = new Set<() => void>();
  const sdk = { ...fixture.mdbase, getSnapshot: () => snapshot, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, addCollection: async () => { throw { problem: "account_collection_quota_exceeded" }; } };
  document.getElementById("root")!.hidden = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(<AppI18nProvider><button type="button" onClick={() => { snapshot = { ...snapshot, collections: [] }; for (const listener of listeners) listener(); }}>Free a collection slot</button><App sdk={sdk} /></AppI18nProvider>);
  return { close: async () => { root.unmount(); host.remove(); await fixture.close(); } };
}

export async function mountNative(body = "# Original manuscript\n\nConfirmed native text.\n") {
  const names = ["manuscript", "source", "comment"];
  const fixture = await createTestApp({
    declaration: { id: "writer.polish", name: "Writer polish", origin: "https://writer.mdbase.dev", environment: "lab", manifest },
    collections: [{ name: "Writing", contracts: manifest.requirements.contracts.map((contract, index) => ({
      id: contract.id, version: contract.version, contractDigest: contract.digest, type: names[index]!, fields: { title: "title", template: "template", csl: "csl" },
    })), records: [{ path: "writing/main.md", types: ["manuscript"], frontmatter: { title: "Original manuscript" }, body }] }],
    phase: "ready",
  });
  fixture.client().describe = async () => ({
    specVersion: "0.3.0", settings: {}, issues: [], inclusion: { include: ["image"] },
    contracts: manifest.requirements.contracts.map((contract, index) => ({ ...contract, path: `_contracts/${contract.id}.md`, digest: contract.digest.replace(/^sha256:/, ""), contractType: "record", implementedBy: [names[index]!] })),
    types: manifest.requirements.contracts.map((contract, index) => ({ name: names[index]!, path: `_types/${names[index]}.md`, implements: [{ contract: contract.id, version: contract.version, fields: { title: "title", template: "template", csl: "csl" } }] })),
  });
  document.getElementById("root")!.hidden = true;
  const host = document.createElement("div");
  host.style.height = "100%";
  document.body.append(host);
  const root = createRoot(host);
  let status: ReturnType<typeof fixture.mdbase.getSnapshot> | null = null;
  const listeners = new Set<() => void>();
  const sdk = { ...fixture.mdbase, getSnapshot: () => status ?? fixture.mdbase.getSnapshot(), subscribe(listener: () => void) {
    listeners.add(listener);
    const stop = fixture.mdbase.subscribe(listener);
    return () => { listeners.delete(listener); stop(); };
  } };
  root.render(<AppI18nProvider><App sdk={sdk} /></AppI18nProvider>);
  return { ...fixture, setSyncHealth(health: "unreachable" | null) {
    const snapshot = fixture.mdbase.getSnapshot();
    if (!snapshot.sync) throw new Error("Sync status requires a ready native fixture");
    status = health ? { ...snapshot, sync: { ...snapshot.sync, health } } : null;
    listeners.forEach(listener => listener());
  }, close: async () => { root.unmount(); host.remove(); await fixture.close(); } };
}
