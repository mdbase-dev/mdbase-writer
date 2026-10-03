import { FeedbackButton } from "@mdbase-dev/ui/feedback";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { FeedbackRoot } from "./FeedbackRoot.js";

afterEach(() => vi.unstubAllEnvs());

it("hides unconfigured feedback without hiding the Writer shell", () => {
  vi.stubEnv("VITE_MDBASE_FEEDBACK_URL", "");
  const markup = renderToStaticMarkup(createElement(FeedbackRoot, { children: [createElement("p", { key: "shell" }, "Writer shell"), createElement(FeedbackButton, { key: "feedback" })] }));
  expect(markup).toContain("Writer shell");
  expect(markup).not.toContain("Send feedback");
});

it("uses the shared entry and excludes unsafe destinations", () => {
  for (const endpoint of ["https://feedback.example/v1/feedback", "javascript:alert(1)"]) {
    vi.stubEnv("VITE_MDBASE_FEEDBACK_URL", endpoint);
    const markup = renderToStaticMarkup(createElement(FeedbackRoot, { children: createElement(FeedbackButton) }));
    expect(markup.includes("Send feedback")).toBe(endpoint.startsWith("https:"));
  }
});
