import "@mdbase-dev/ui/fonts.css";
import "@mdbase-dev/ui/tokens.css";
import "@mdbase-dev/ui/brand.css";
import "@mdbase-dev/ui/controls.css";
import "@mdbase-dev/ui/screens.css";
import "@mdbase-dev/ui/palette.css";
import "@mdbase-dev/ui/feedback.css";
import "./feedback-shell.css";
import "./styles.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App.js";
import { FeedbackRoot } from "./FeedbackRoot.js";

import { setupPwaInstall } from "./pwa-install.js";
import "./pwa-install.css";

const stopPwaInstall = setupPwaInstall("mdbase writer");
if (import.meta.hot) import.meta.hot.dispose(stopPwaInstall);

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(
  <StrictMode>
    <FeedbackRoot><App /></FeedbackRoot>
  </StrictMode>,
);
