import test from "node:test";
import assert from "node:assert/strict";

import {
  persistExtractionState,
  readPopupState,
  startExtractionState
} from "../lib/extract-state.js";

function createStorage() {
  const localData = {};
  const sessionData = {};
  const createArea = (data) => ({
    async get(keys) {
      return Object.fromEntries(
        keys.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]])
      );
    },
    async set(values) {
      Object.assign(data, values);
    }
  });

  return {
    local: createArea(localData),
    session: createArea(sessionData),
    localData,
    sessionData
  };
}

test("keeps the last input locally but stores extraction results only for this session", async () => {
  const storage = createStorage();
  await startExtractionState(storage, "  BV1xx411c7mD  ", "2026-07-15T00:00:00.000Z");
  await persistExtractionState(storage, {
    status: "success",
    result: { tracks: [{ body: [{ from: 0, to: 1, content: "subtitle" }] }] }
  });

  assert.deepEqual(storage.localData, { lastInput: "BV1xx411c7mD" });
  assert.equal(Object.hasOwn(storage.localData, "extractState"), false);
  assert.equal(storage.sessionData.extractState.status, "success");

  assert.deepEqual(await readPopupState(storage), {
    lastInput: "BV1xx411c7mD",
    extractState: storage.sessionData.extractState
  });
});
