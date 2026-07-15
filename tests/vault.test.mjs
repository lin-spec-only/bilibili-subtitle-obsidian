import test from "node:test";
import assert from "node:assert/strict";

import {
  OBSIDIAN_DIRECTORY_PICKER_ID,
  isObsidianVaultRoot,
  resolveVaultRelativePath,
  writeNewMarkdownFile
} from "../lib/vault.js";

test("uses a browser-compatible directory picker identifier", () => {
  assert.ok(OBSIDIAN_DIRECTORY_PICKER_ID.length <= 32);
});

test("recognizes an Obsidian Vault root from its .obsidian directory", async () => {
  const vaultRoot = {
    kind: "directory",
    async getDirectoryHandle(name) {
      if (name === ".obsidian") {
        return { kind: "directory" };
      }
      const error = new Error("not found");
      error.name = "NotFoundError";
      throw error;
    }
  };
  const nestedDirectory = {
    kind: "directory",
    async getDirectoryHandle() {
      const error = new Error("not found");
      error.name = "NotFoundError";
      throw error;
    }
  };

  assert.equal(await isObsidianVaultRoot(vaultRoot), true);
  assert.equal(await isObsidianVaultRoot(nestedDirectory), false);
});

test("resolves root and nested save folders to Vault-relative paths", async () => {
  const vaultRoot = {
    async resolve(directory) {
      return directory.name === "Vault" ? [] : ["Sources", "Bilibili"];
    }
  };

  assert.equal(await resolveVaultRelativePath(vaultRoot, { name: "Vault" }), "");
  assert.equal(await resolveVaultRelativePath(vaultRoot, { name: "Bilibili" }), "Sources/Bilibili");
  await assert.rejects(
    () => resolveVaultRelativePath({ async resolve() { return null; } }, { name: "Elsewhere" }),
    /不在此 Obsidian Vault 内/
  );
});

function createFakeDirectory(existing = []) {
  const files = new Map(existing.map((name) => [name, "已有内容"]));
  return {
    kind: "directory",
    name: "Bilibili",
    files,
    async queryPermission() {
      return "granted";
    },
    async requestPermission() {
      return "granted";
    },
    async getFileHandle(name, options) {
      if (!options?.create && !files.has(name)) {
        const error = new Error("not found");
        error.name = "NotFoundError";
        throw error;
      }
      if (options?.create && !files.has(name)) {
        files.set(name, "");
      }
      return {
        async createWritable() {
          return {
            async write(content) {
              files.set(name, content);
            },
            async close() {}
          };
        }
      };
    }
  };
}

test("写入新 Markdown 文件且不覆盖同名笔记", async () => {
  const directory = createFakeDirectory(["视频.md", "视频-2.md"]);
  const filename = await writeNewMarkdownFile(directory, "视频.md", "# 新笔记");
  assert.equal(filename, "视频-3.md");
  assert.equal(directory.files.get("视频.md"), "已有内容");
  assert.equal(directory.files.get("视频-3.md"), "# 新笔记");
});

test("没有写权限时拒绝落盘", async () => {
  const directory = createFakeDirectory();
  directory.queryPermission = async () => "prompt";
  directory.requestPermission = async () => "denied";
  await assert.rejects(
    () => writeNewMarkdownFile(directory, "视频.md", "内容"),
    /没有获得所选目录的写入权限/
  );
});
