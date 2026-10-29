// Render the native sign-in screen without starting an SDK or contacting Connect.
import { createRoot } from "react-dom/client";
import type { Mdbase } from "@mdbase-dev/sdk";
import { App } from "../src/App.js";
import { AppI18nProvider } from "../src/i18n/provider.js";

export function mountSignIn() {
  document.getElementById("root")!.hidden = true;
  const host = document.createElement("div");
  document.body.append(host);
  const snapshot = { status: "signed_out", phase: { kind: "signed_out" }, collections: [], signIn: null };
  const sdk = { getSnapshot: () => snapshot, subscribe: () => () => {} } as unknown as Mdbase;
  const root = createRoot(host);
  root.render(<AppI18nProvider><App sdk={sdk} /></AppI18nProvider>);
}
