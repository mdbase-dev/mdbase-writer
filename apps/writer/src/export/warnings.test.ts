import { expect, it } from "vitest";
import { pandocWarnings } from "./warnings.js";

it("explains Word's missing-image fallback without hiding other warnings", () => {
  const warning = "Could not fetch resource figures/example.png: replacing image with description";
  const guidance = "The image “figures/example.png” could not be loaded for Word. Its description will be included instead.";
  expect(pandocWarnings([
    warning,
    { verbosity: "WARNING", pretty: warning },
    { verbosity: "WARNING", pretty: "Unknown citation key" },
    { verbosity: "WARNING" },
  ])).toEqual([guidance, guidance, "Unknown citation key", "Word export reported a problem."]);
});
it("does not interrupt a clean export with informational resource messages", () => {
  expect(pandocWarnings([{ type: "LoadedResource", verbosity: "INFO", pretty: "Loaded style.csl" }, { verbosity: "DEBUG" }, { verbosity: "WARNING", pretty: "Image missing" }, "Citation missing"])).toEqual(["Image missing", "Citation missing"]);
});
