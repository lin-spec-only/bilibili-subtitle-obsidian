import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExtractionScope,
  doesExtractionStateMatchScope,
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
  const scope = buildExtractionScope(42, "https://www.bilibili.com/video/BV1xx411c7mD?p=2", 2);
  await startExtractionState(storage, "  BV1xx411c7mD  ", "2026-07-15T00:00:00.000Z", scope);
  await persistExtractionState(storage, {
    status: "success",
    scope,
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

test("matches extraction state only to its original tab and video", () => {
  const scope = buildExtractionScope(42, "https://www.bilibili.com/video/BV1xx411c7mD", 1);
  assert.equal(doesExtractionStateMatchScope({ scope }, scope), true);
  assert.equal(doesExtractionStateMatchScope({ scope }, buildExtractionScope(43, "https://www.bilibili.com/video/BV1xx411c7mD", 1)), false);
  assert.equal(doesExtractionStateMatchScope({ scope }, buildExtractionScope(42, "https://www.bilibili.com/video/BV1another99", 1)), false);
});
