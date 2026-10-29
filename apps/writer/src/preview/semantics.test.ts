// @vitest-environment jsdom
import { expect, it } from "vitest";
import { semanticLayer } from "./semantics.js";

it("removes empty internal PDF links and names empty external links by destination", () => {
  const layer = semanticLayer('<a href="#"></a><a href="https://example.com/paper"></a><a href="mailto:author@example.com"></a><a href="https://example.com">Paper</a>');
  expect(layer.querySelectorAll("a")).toHaveLength(3);
  expect(layer.querySelectorAll("a")[0]?.getAttribute("aria-label")).toBe("https://example.com/paper");
  expect(layer.querySelectorAll("a")[1]?.getAttribute("aria-label")).toBe("mailto:author@example.com");
  expect(layer.querySelectorAll("a")[2]?.textContent).toBe("Paper");
});

it("preserves named links and still strips unsafe hrefs and active content", () => {
  const layer = semanticLayer('<a href="#" aria-label="Figure 1"></a><a href="javascript:alert(1)">Text</a><script>alert(1)</script>');
  expect(layer.querySelector("a")?.getAttribute("aria-label")).toBe("Figure 1");
  expect(layer.querySelectorAll("[href]")).toHaveLength(1);
  expect(layer.querySelector("script")).toBeNull();
});
