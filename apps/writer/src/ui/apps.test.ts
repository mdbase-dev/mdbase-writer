import { describe, expect, it } from "vitest";

import { mdbaseAppHref } from "./apps.js";

describe("mdbaseAppHref", () => {
  it("carries the collection and server to the other app", () => {
    expect(
      mdbaseAppHref(
        "https://lab.mdbase-writer.pages.dev/",
        "https://reader.mdbase.dev/?collection=col_123&server=https%3A%2F%2Fconnect.example.org",
      ),
    ).toBe(
      "https://lab.mdbase-writer.pages.dev/?collection=col_123&server=https%3A%2F%2Fconnect.example.org",
    );
  });

  it("leaves app-specific parameters behind", () => {
    expect(
      mdbaseAppHref(
        "https://editor.mdbase.dev/",
        "https://reader.mdbase.dev/?collection=col_123&source=smith-2021#page=4",
      ),
    ).toBe("https://editor.mdbase.dev/?collection=col_123");
  });

  it("opens the app without a collection when none is selected", () => {
    expect(mdbaseAppHref("https://editor.mdbase.dev/", "https://reader.mdbase.dev/")).toBe(
      "https://editor.mdbase.dev/",
    );
  });

  it("keeps the target app's own base path", () => {
    expect(mdbaseAppHref("http://127.0.0.1:5320/lab/", "http://127.0.0.1:5173/?collection=c")).toBe(
      "http://127.0.0.1:5320/lab/?collection=c",
    );
  });
});
