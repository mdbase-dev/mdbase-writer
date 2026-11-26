// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { fail, ok } from "../backend/types.js";
import { render } from "../test/render.js";
import { DeleteDocumentDialog } from "./DeleteDocumentDialog.js";

beforeAll(() => {
  globalThis.matchMedia ??= () => ({ matches: true, media: "", onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true });
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };
});
afterEach(() => { cleanup(); });

it("requires typing the exact document title before enabling Delete document", async () => {
  const onDelete = vi.fn(async () => ok(undefined));
  const onDeleted = vi.fn();
  const onClose = vi.fn();

  render(
    <DeleteDocumentDialog
      target={{ path: "manuscripts/coral-reefs.md", title: "Coral Reefs" }}
      open={true}
      onClose={onClose}
      onDelete={onDelete}
      onDeleted={onDeleted}
    />,
  );

  const confirm = screen.getByRole("button", { name: "Delete document" }) as HTMLButtonElement;
  const input = screen.getByRole("textbox");
  expect(confirm.disabled).toBe(true);

  fireEvent.change(input, { target: { value: "coral reefs" } });
  expect(confirm.disabled).toBe(true);

  fireEvent.change(input, { target: { value: "Coral Reefs" } });
  expect(confirm.disabled).toBe(false);

  fireEvent.click(confirm);
  await waitFor(() => expect(onDelete).toHaveBeenCalledWith("manuscripts/coral-reefs.md"));
  expect(onDeleted).toHaveBeenCalledWith("manuscripts/coral-reefs.md");
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("keeps the dialog open and shows an alert when deletion fails", async () => {
  const onDelete = vi.fn(async () => fail<void>("Writer does not have permission to delete documents in this collection."));
  const onDeleted = vi.fn();
  const onClose = vi.fn();

  render(
    <DeleteDocumentDialog
      target={{ path: "manuscripts/coral-reefs.md", title: "Coral Reefs" }}
      open={true}
      onClose={onClose}
      onDelete={onDelete}
      onDeleted={onDeleted}
    />,
  );

  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Coral Reefs" } });
  fireEvent.click(screen.getByRole("button", { name: "Delete document" }));

  expect((await screen.findByRole("alert")).textContent).toContain("Writer does not have permission to delete documents in this collection.");
  expect(onDeleted).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});
