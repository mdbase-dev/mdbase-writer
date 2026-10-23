// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { createPortal } from "react-dom";
import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useLingui } from "@lingui/react";
import { act } from "react";
import { render } from "../test/render.js";
import { i18n, runtime } from "./app.js";
import { formatNumber, formatDate } from "./presentation.js";
import { plural, STATE_LABEL } from "../ui/records.js";
import { noteName } from "../ui/names.js";

beforeEach(async () => { await runtime.selectLocale("en"); });
afterEach(async () => { cleanup(); await runtime.selectLocale("en"); });

function Example() {
  useLingui();
  return <><span>{t`Saved`}</span>{createPortal(<p><Trans>Keep writing</Trans></p>, document.body)}<output>{formatNumber(1234.5)}</output></>;
}

it("renders real English macros synchronously in the root and a portal", () => {
  render(<Example />);
  expect(screen.getByText("Saved")).toBeTruthy();
  expect(screen.getByText("Keep writing")).toBeTruthy();
  expect(i18n.locale).toBe("en");
  expect(STATE_LABEL.saved).toBe("Saved");
});

it("uses whole ICU count messages for zero, one and many", () => {
  expect([0, 1, 2].map(n => plural(n, "word"))).toEqual(["0 words", "1 word", "2 words"]);
  expect([0, 1, 2].map(n => plural(n, "open comment"))).toEqual(["0 open comments", "1 open comment", "2 open comments"]);
});

it("updates display formatting, document language and persisted choice without remounting", async () => {
  render(<Example />);
  const node = screen.getByRole("status");
  await act(async () => { await runtime.selectLocale("de"); });
  expect(screen.getByRole("status")).toBe(node);
  expect(node.textContent).toBe("1.234,5");
  expect(document.documentElement.lang).toBe("de");
  expect(localStorage.getItem("mdbase-writer:interface-locale")).toBe("de");
});

it("keeps record paths and user-derived names untouched by interface selection", async () => {
  const path = "drafts/東京.md";
  const before = noteName(path);
  await runtime.selectLocale("ja");
  expect(noteName(path)).toBe(before);
  expect(path).toBe("drafts/東京.md");
  expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat("ja").format(1234.5));
});

it("uses the plugin's Brazilian Portuguese variant for display dates and numbers", async () => {
  await runtime.selectLocale("pt");
  expect(formatNumber(1234.5)).toBe(new Intl.NumberFormat("pt-BR").format(1234.5));
  const date = new Date(2026, 9, 23);
  expect(formatDate(date, { dateStyle: "long" })).toBe(new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(date));
});
