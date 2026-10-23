import { render as renderReact, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { AppI18nProvider } from "../i18n/provider.js";

/** UI tests use the production translator and catalogue, never a translation mock. */
function Wrapper({ children }: { children: ReactNode }) {
  return <AppI18nProvider>{children}</AppI18nProvider>;
}
export function render(ui: ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return renderReact(ui, { ...options, wrapper: Wrapper });
}
