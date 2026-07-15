import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readManifest() {
  return JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
}

test("permits extension-background downloads only from the Bilibili subtitle CDN", async () => {
  const manifest = await readManifest();
  assert.equal(manifest.host_permissions.includes("https://*.hdslb.com/*"), true);
});

test("keeps Obsidian destination selection inside the popup flow", async () => {
  const manifest = await readManifest();
  assert.equal(Object.hasOwn(manifest, "options_page"), false);
});

test("keeps the extension and package versions aligned for releases", async () => {
  const manifest = await readManifest();
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, packageJson.version);
});
