// @vitest-environment jsdom
import { expect, it } from "vitest";
import { mdbaseAppHref, withAppUrls } from "@mdbase-dev/ui/apps";
import { appUrls } from "./apps.js";

it("offers only apps this build names a URL for, never a production default", () => {
  expect(withAppUrls({})).toEqual([]);
  expect(withAppUrls({ ...appUrls, reader: "" }).map(app => app.id)).toEqual(["editor", "writer"]);
  expect(withAppUrls(appUrls).map(app => new URL(mdbaseAppHref(app.url, "https://lab.mdbase-writer.pages.dev/?collection=lab-only"))))
    .toEqual([
      new URL("https://editor-lab.mdbase.dev/?collection=lab-only"),
      new URL("https://lab.mdbase-reader.pages.dev/?collection=lab-only"),
      new URL("https://lab.mdbase-writer.pages.dev/?collection=lab-only"),
    ]);
});
