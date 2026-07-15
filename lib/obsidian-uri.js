export function buildObsidianOpenUri(vaultName, relativeFilePath) {
  const vault = String(vaultName || "").trim();
  const file = String(relativeFilePath || "").replaceAll("\\", "/").replace(/^\/+/, "");
  if (!vault || !file) {
    throw new Error("缺少 Obsidian Vault 名称或笔记路径");
  }
  return `obsidian://open?vault=${encodeURIComponent(vault)}&file=${encodeURIComponent(file)}`;
}
