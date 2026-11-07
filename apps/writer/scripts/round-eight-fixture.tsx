import { createRoot } from "react-dom/client";
import { useState } from "react";
import { createTestApp } from "@mdbase-dev/sdk/testing";
import { CollectionGate } from "@mdbase-dev/ui/collections";
import { createDemoBackend } from "../src/backend/demo.js";
import { ManuscriptWorkspace } from "../src/workspace/workspace.js";
import { AppI18nProvider } from "../src/i18n/provider.js";
import { WorkspaceView } from "../src/ui/WorkspaceView.js";
import { ConnectionNoticeContext, type ConnectionNotice } from "../src/ui/connection-notice.js";
import { AppSwitcher } from "../src/ui/AppSwitcher.js";
import { TopbarSlot } from "../src/ui/topbar.js";

export async function mount() {
  const backend = await createDemoBackend();
  const workspace = new ManuscriptWorkspace(backend, "manuscripts/slow-change.md");
  const app = await createTestApp();
  const original = app.mdbase.getSnapshot;
  let snapshot = { ...original(), saveWarning: null as "storage_may_be_evicted" | null };
  const mdbase = { ...app.mdbase, getSnapshot: () => snapshot };
  const host = document.createElement("div");
  host.id = "round-eight";
  host.style.height = "100%";
  document.querySelector<HTMLElement>("#root")!.hidden = true;
  document.body.append(host);
  const root = createRoot(host);
  let update: (notice: ConnectionNotice | null) => void = () => {};
  function Fixture() {
    const [slot, setSlot] = useState<HTMLElement | null>(null);
    const [notice, setNotice] = useState<ConnectionNotice | null>(null);
    update = setNotice;
    return <AppI18nProvider><div className="app"><header className="topbar"><AppSwitcher /><div className="topbar-slot" ref={setSlot} /></header>
      <TopbarSlot.Provider value={slot}><ConnectionNoticeContext.Provider value={notice}>
        <CollectionGate mdbase={mdbase} app={{ name: "Writer fixture" }}>
          {() => <WorkspaceView workspace={workspace} onClose={() => {}} />}
        </CollectionGate>
      </ConnectionNoticeContext.Provider></TopbarSlot.Provider>
    </div></AppI18nProvider>;
  }
  root.render(<Fixture />);
  return {
    workspace,
    notice: (notice: ConnectionNotice | null) => { snapshot = { ...snapshot, saveWarning: notice ? "storage_may_be_evicted" : null }; update(notice); },
    close: async () => { root.unmount(); await workspace.dispose(); backend.dispose(); await app.close(); host.remove(); },
  };
}
