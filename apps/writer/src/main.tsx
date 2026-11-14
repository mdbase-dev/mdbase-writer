import { t } from "@lingui/core/macro";
import { OpeningScreen } from "@mdbase-dev/ui/screens";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import "@mdbase-dev/ui/fonts.css";
import "@mdbase-dev/ui/tokens.css";
import "@mdbase-dev/ui/brand.css";
import "@mdbase-dev/ui/motion.css";
import "@mdbase-dev/ui/controls.css";
import "@mdbase-dev/ui/screens.css";
import "@mdbase-dev/ui/palette.css";
import "@mdbase-dev/ui/feedback.css";
import "@mdbase-dev/ui/comments.css";
import "./feedback-shell.css";
import "./styles.css";

import { lazy, Suspense, StrictMode } from "react";
import { AppI18nProvider } from "./i18n/provider.js";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { writerDemoRequested } from "./demo-mode.js";
import { FeedbackRoot } from "./FeedbackRoot.js";
import { deliverWriterGrantReturn, isWriterGrantReturn, writerMdbaseForBuild } from "./connect/sdk-application.js";

import { setupPwaInstall } from "./pwa-install.js";
import "./pwa-install.css";

function OpeningDemo() {
  useLingui();
  return <OpeningScreen app="writer" title={t`Opening mdbase writer`} />;
}

const stopPwaInstall = setupPwaInstall("mdbase writer");
if (import.meta.hot) import.meta.hot.dispose(stopPwaInstall);

// The demo import is compiled out of ordinary production/staging/LAB builds.
const DemoRoot = import.meta.env.DEV || import.meta.env.VITE_WRITER_DEMO === "1"
  ? lazy(() => import("./ui/DemoRoot.js")) : undefined;
const environment = import.meta.env.VITE_MDBASE_ENV || (import.meta.env.DEV ? "lab" : undefined);
// The Private collection consent popup returns here: hand its result to the
// waiting Writer tab and close, without starting a second SDK owner.
const grantReturn = isWriterGrantReturn(environment, location.href);
if (grantReturn) void deliverWriterGrantReturn(location.href).catch(() => {});
// One declaration-only singleton outside React/StrictMode. SDK owns its runtime.
const sdk = grantReturn || writerDemoRequested() ? undefined : writerMdbaseForBuild(environment);
const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode><AppI18nProvider>
    {grantReturn ? <p className="grant-return"><Trans>You can close this window.</Trans></p>
      : <FeedbackRoot>{sdk ? <App sdk={sdk} /> : DemoRoot ?
        <Suspense fallback={<OpeningDemo />}><DemoRoot /></Suspense> : null}</FeedbackRoot>}
  </AppI18nProvider></StrictMode>,
);
