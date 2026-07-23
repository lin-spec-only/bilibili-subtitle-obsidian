import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function readManifest() {
  return JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
}

test("permits extension-background downloads only from the Bilibili subtitle CDN", async () => {
  const manifest = await readManifest();
  assert.equal(manifest.host_permissions.includes("https://*.hdslb.com/*"), true);
  assert.equal(manifest.host_permissions.includes("http://127.0.0.1:8766/*"), true);
  assert.equal(manifest.host_permissions.some((item) => item.includes("localhost")), false);
});

test("keeps Obsidian destination selection inside the popup flow", async () => {
  const manifest = await readManifest();
  assert.equal(Object.hasOwn(manifest, "options_page"), false);
});

test("lets the user pick the final save folder in one system dialog", async () => {
  const popupSource = await readFile(new URL("../popup.js", import.meta.url), "utf8");
  const popupHtml = await readFile(new URL("../popup.html", import.meta.url), "utf8");
  assert.equal((popupSource.match(/await window\.showDirectoryPicker/g) || []).length, 1);
  assert.match(popupSource, /return chooseVaultSaveDirectory\(\{ quiet \}\)/);
  assert.match(popupSource, /requestDirectoryPermission\(directory\)/);
  assert.doesNotMatch(popupHtml, /id="change-vault"/);
  assert.match(popupHtml, /id="change-vault-directory"[\s\S]*?hidden/);
  assert.doesNotMatch(popupSource, /vault-subdirectory/);
});

test("keeps the extension and package versions aligned for releases", async () => {
  const manifest = await readManifest();
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.version, packageJson.version);
});
