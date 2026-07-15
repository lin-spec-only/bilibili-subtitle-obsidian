import test from "node:test";
import assert from "node:assert/strict";

import { buildObsidianOpenUri } from "../lib/obsidian-uri.js";

test("builds an encoded URI that opens the saved note in its vault", () => {
  assert.equal(
    buildObsidianOpenUri("My Vault", "Inbox/B站/视频 笔记.md"),
    "obsidian://open?vault=My%20Vault&file=Inbox%2FB%E7%AB%99%2F%E8%A7%86%E9%A2%91%20%E7%AC%94%E8%AE%B0.md"
  );
});

test("rejects incomplete Obsidian note targets", () => {
  assert.throws(() => buildObsidianOpenUri("", "note.md"), /缺少/);
  assert.throws(() => buildObsidianOpenUri("Vault", ""), /缺少/);
});
