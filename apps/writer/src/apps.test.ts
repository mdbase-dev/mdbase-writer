// @vitest-environment jsdom
import { expect, it } from "vitest";
import { mdbaseAppHref, withAppUrls } from "@mdbase-dev/ui/apps";
import { appUrls } from "./apps.js";

it("requires every handoff URL instead of supplying production defaults", () => {
  expect(() => withAppUrls({})).toThrow("Missing URL");
  expect(() => withAppUrls({ ...appUrls, reader: "" })).toThrow("Missing URL");
  expect(withAppUrls(appUrls).map(app => new URL(mdbaseAppHref(app.url, "https://lab.mdbase-writer.pages.dev/?collection=lab-only"))))
    .toEqual([
      new URL("https://editor-lab.mdbase.dev/?collection=lab-only"),
      new URL("https://lab.mdbase-reader.pages.dev/?collection=lab-only"),
      new URL("https://lab.mdbase-writer.pages.dev/?collection=lab-only"),
    ]);
});
