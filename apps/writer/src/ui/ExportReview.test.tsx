// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { ExportReview, type PendingExport } from "./ExportReview.js";

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");
beforeAll(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value(this: HTMLDialogElement) {
      if (!this.open) return;
      this.open = false;
      // Native close is queued after the render which sets open=false.
      setTimeout(() => this.dispatchEvent(new Event("close")), 0);
    } },
  });
});
afterAll(() => {
  for (const [name, descriptor] of [["showModal", originalShow], ["close", originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.runOnlyPendingTimers(); vi.useRealTimers(); });

const pending: PendingExport = {
  bytes: new Uint8Array([80, 75]), type: "application/octet-stream", name: "test.docx",
  problems: ["No source in the library has the citekey missing."],
};
function Harness({ download, cancel }: { download: (file: PendingExport) => void; cancel: () => void }) {
  const [file, setFile] = useState<PendingExport | null>(pending);
  const [notice, setNotice] = useState<string | null>(null);
  return <>
    <ExportReview pending={file} onCancel={() => { cancel(); setFile(null); setNotice(null); }} onExport={(chosen) => {
      setFile(null);
      download(chosen);
      setNotice("Exported Word with a problem.");
    }} onError={(error) => setNotice(`The file could not be downloaded. ${String(error)}`)} />
    {notice && <div role="status">{notice}</div>}
  </>;
}

it("downloads only after consent and retains the result after the dialog's native close", () => {
  const download = vi.fn(), cancel = vi.fn();
  render(<Harness download={download} cancel={cancel} />);
  expect(download).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Export anyway" }));
  act(() => vi.runOnlyPendingTimers());
  expect(download).toHaveBeenCalledExactlyOnceWith(pending);
  expect(cancel).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toBe("Exported Word with a problem.");
});

it("reports a failed download and retains the error after native close", () => {
  const cancel = vi.fn();
  render(<Harness download={() => { throw new Error("Browser storage unavailable."); }} cancel={cancel} />);
  fireEvent.click(screen.getByRole("button", { name: "Export anyway" }));
  act(() => vi.runOnlyPendingTimers());
  expect(cancel).not.toHaveBeenCalled();
  expect(screen.getByRole("status").textContent).toContain("The file could not be downloaded.");
  expect(screen.getByRole("status").textContent).toContain("Browser storage unavailable.");
});

it.each(["cancel", "escape", "backdrop", "close"])("keeps %s as a cancellation without a download", (action) => {
  const download = vi.fn(), cancel = vi.fn();
  render(<Harness download={download} cancel={cancel} />);
  if (action === "cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel and fix problems" }));
  else if (action === "escape") fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  else if (action === "backdrop") fireEvent.mouseDown(screen.getByRole("dialog"));
  else fireEvent.click(screen.getByRole("button", { name: "Close" }));
  act(() => vi.runOnlyPendingTimers());
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(download).not.toHaveBeenCalled();
  expect(screen.queryByRole("status")).toBeNull();
});
