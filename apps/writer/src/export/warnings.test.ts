import { expect, it } from "vitest";
import { pandocWarnings } from "./warnings.js";
it("does not interrupt a clean export with informational resource messages", () => {
  expect(pandocWarnings([{ type: "LoadedResource", verbosity: "INFO", pretty: "Loaded style.csl" }, { verbosity: "DEBUG" }, { verbosity: "WARNING", pretty: "Image missing" }, "Citation missing"])).toEqual(["Image missing", "Citation missing"]);
});
