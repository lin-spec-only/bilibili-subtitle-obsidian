const DATABASE_NAME = "bilibili-subtitle-vault";
const STORE_NAME = "handles";
const DIRECTORY_KEY = "note-directory";
const VAULT_ROOT_KEY = "vault-root-directory";
const RELATIVE_DIRECTORY_KEY = "vault-relative-directory";
export const OBSIDIAN_DIRECTORY_PICKER_ID = "bili-obsidian";

export async function getVaultDirectory() {
  return getStoredValue(DIRECTORY_KEY);
}

export async function getVaultDestination() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const directoryRequest = store.get(DIRECTORY_KEY);
    const vaultRootRequest = store.get(VAULT_ROOT_KEY);
    const relativePathRequest = store.get(RELATIVE_DIRECTORY_KEY);
    transaction.oncomplete = () => {
      database.close();
      resolve({
        directory: directoryRequest.result || null,
        vaultRoot: vaultRootRequest.result || null,
        relativePath: String(relativePathRequest.result || "")
      });
    };
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function setVaultDirectory(handle) {
  if (!handle || handle.kind !== "directory") {
    throw new Error("没有选择有效的文件夹");
  }
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(handle, DIRECTORY_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function setVaultDestination({ directory, vaultRoot, relativePath }) {
  if (!directory || directory.kind !== "directory" || !vaultRoot || vaultRoot.kind !== "directory") {
    throw new Error("没有选择有效的 Obsidian 保存位置");
  }
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.put(directory, DIRECTORY_KEY);
    store.put(vaultRoot, VAULT_ROOT_KEY);
    store.put(String(relativePath || ""), RELATIVE_DIRECTORY_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function clearVaultDirectory() {
  const database = await openDatabase();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    store.delete(DIRECTORY_KEY);
    store.delete(VAULT_ROOT_KEY);
    store.delete(RELATIVE_DIRECTORY_KEY);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function getDirectoryPermission(handle) {
  if (!handle) {
    return "missing";
  }
  return handle.queryPermission({ mode: "readwrite" });
}

export async function isObsidianVaultRoot(handle) {
  if (!handle || handle.kind !== "directory") {
    return false;
  }
  try {
    const configDirectory = await handle.getDirectoryHandle(".obsidian", { create: false });
    return configDirectory?.kind === "directory";
  } catch (error) {
    if (error?.name === "NotFoundError") {
      return false;
    }
    throw error;
  }
}

export async function resolveVaultRelativePath(vaultRoot, directory) {
  if (!vaultRoot || !directory || typeof vaultRoot.resolve !== "function") {
    throw new Error("当前 Edge 不支持解析 Obsidian 保存目录");
  }
  const segments = await vaultRoot.resolve(directory);
  if (!Array.isArray(segments)) {
    throw new Error("所选保存目录不在此 Obsidian Vault 内");
  }
  return segments.join("/");
}

export async function requestDirectoryPermission(handle) {
  if (!handle) {
    return "missing";
  }
  const current = await getDirectoryPermission(handle);
  if (current === "granted") {
    return current;
  }
  return handle.requestPermission({ mode: "readwrite" });
}

export async function writeNewMarkdownFile(directory, preferredFilename, content) {
  if (!directory) {
    throw new Error("尚未设置 Obsidian 保存目录");
  }
  const permission = await requestDirectoryPermission(directory);
  if (permission !== "granted") {
    throw new Error("没有获得所选目录的写入权限");
  }

  const filename = await findAvailableFilename(directory, preferredFilename);
  const fileHandle = await directory.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(String(content ?? ""));
  } finally {
    await writable.close();
  }
  return filename;
}

async function findAvailableFilename(directory, preferredFilename) {
  const match = String(preferredFilename).match(/^(.*?)(\.[^.]+)?$/);
  const stem = match?.[1] || "B站字幕";
  const extension = match?.[2] || ".md";

  for (let number = 1; number <= 999; number += 1) {
    const candidate = number === 1 ? `${stem}${extension}` : `${stem}-${number}${extension}`;
    try {
      await directory.getFileHandle(candidate, { create: false });
    } catch (error) {
      if (error?.name === "NotFoundError") {
        return candidate;
      }
      throw error;
    }
  }
  throw new Error("同名笔记过多，请调整视频标题后再保存");
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getStoredValue(key) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
}
