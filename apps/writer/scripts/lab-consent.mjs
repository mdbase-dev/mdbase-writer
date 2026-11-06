import assert from "node:assert/strict";

export async function selectLabCollection(popup, collectionName) {
  const choice = popup.getByRole("option", { name: collectionName, exact: true });
  assert.equal(await choice.count(), 1, "The owned test collection must be an unambiguous consent choice");
  const preselected = await choice.getAttribute("aria-selected") === "true";
  await choice.click();
  assert.equal(await choice.getAttribute("aria-selected"), "true");
  assert.equal(await popup.getByRole("option", { selected: true }).count(), 1, "Never approve additional collections");
  await popup.locator("details").filter({ hasText: "Allow mdbase writer to create new collections" }).locator("summary").click();
  const create = popup.getByRole("checkbox", { name: /Allow mdbase writer to create new collections/ });
  if (await create.isChecked()) await create.uncheck();
  assert.equal(await create.isChecked(), false, "Do not grant collection creation during reload/write testing");
  return preselected;
}
