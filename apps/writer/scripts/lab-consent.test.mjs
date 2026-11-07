import assert from "node:assert/strict";
import { test } from "node:test";
import { selectLabCollection } from "./lab-consent.mjs";

test("LAB consent uses the exact single-select option, never a collection checkbox", async () => {
  const selected = new Set(["Other"]);
  let create = true;
  const popup = {
    getByRole(role, { name, selected: onlySelected } = {}) {
      if (role === "checkbox") return { count: async () => name instanceof RegExp && name.test("Allow mdbase writer to create new collections") ? 1 : 0, isChecked: async () => create, uncheck: async () => { create = false; } };
      assert.equal(role, "option");
      if (onlySelected) return { count: async () => selected.size };
      assert.equal(name, "[test] Exact collection");
      return { count: async () => 1, getAttribute: async () => String(selected.has(name)), click: async () => { selected.clear(); selected.add(name); } };
    },
    locator(selector) {
      assert.equal(selector, "details");
      return { filter: () => ({ locator: () => ({ click: async () => {} }) }) };
    },
  };
  assert.equal(await selectLabCollection(popup, "[test] Exact collection"), false);
  assert.deepEqual([...selected], ["[test] Exact collection"]);
  assert.equal(create, false);
  assert.equal(await selectLabCollection(popup, "[test] Exact collection"), true);
});
