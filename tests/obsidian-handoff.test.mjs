import test from "node:test";
import assert from "node:assert/strict";

import {
  approveObsidianAutoOpen,
  hasObsidianAutoOpenApproval,
  OBSIDIAN_AUTO_OPEN_APPROVED_KEY
} from "../lib/obsidian-handoff.js";

function createStorage(initial = {}) {
  const local = { ...initial };
  return {
    local: {
      async get(keys) {
        return Object.fromEntries(keys.map((key) => [key, local[key]]));
      },
      async set(values) {
        Object.assign(local, values);
      }
    }
  };
}

test("requires an explicit first-time approval before automatic Obsidian opening", async () => {
  const storage = createStorage();
  assert.equal(await hasObsidianAutoOpenApproval(storage), false);

  await approveObsidianAutoOpen(storage);

  assert.equal(await hasObsidianAutoOpenApproval(storage), true);
});

test("does not treat an absent or non-true setting as approved", async () => {
  assert.equal(
    await hasObsidianAutoOpenApproval(createStorage({ [OBSIDIAN_AUTO_OPEN_APPROVED_KEY]: "true" })),
    false
  );
});
