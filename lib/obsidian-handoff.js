export const OBSIDIAN_AUTO_OPEN_APPROVED_KEY = "obsidianAutoOpenApproved";

export async function hasObsidianAutoOpenApproval(storage) {
  const saved = await storage.local.get([OBSIDIAN_AUTO_OPEN_APPROVED_KEY]);
  return saved[OBSIDIAN_AUTO_OPEN_APPROVED_KEY] === true;
}

export async function approveObsidianAutoOpen(storage) {
  await storage.local.set({ [OBSIDIAN_AUTO_OPEN_APPROVED_KEY]: true });
}
