export async function readPopupState(storage) {
  const [local, session] = await Promise.all([
    storage.local.get(["lastInput"]),
    storage.session.get(["extractState"])
  ]);

  return {
    lastInput: String(local.lastInput || ""),
    extractState: session.extractState || null
  };
}

export function buildExtractionScope(tabId, sourceUrl, part = null) {
  const bvid = String(sourceUrl || "").match(/\b(BV[0-9A-Za-z]+)\b/i)?.[1]?.toUpperCase() || "";
  return { tabId: Number.isInteger(tabId) && tabId >= 0 ? tabId : null, bvid, part: Number.isInteger(part) && part > 0 ? part : null };
}

export function doesExtractionStateMatchScope(state, scope) {
  return Boolean(state?.scope && scope && state.scope.tabId === scope.tabId && state.scope.bvid === scope.bvid &&
    (state.scope.part === null || scope.part === null || state.scope.part === scope.part));
}

export async function startExtractionState(storage, lastInput, startedAt, scope = null) {
  await Promise.all([
    storage.local.set({ lastInput: String(lastInput || "").trim() }),
    storage.session.set({
      extractState: {
        status: "loading",
        startedAt,
        scope
      }
    })
  ]);
}

export async function persistExtractionState(storage, extractState) {
  await storage.session.set({ extractState });
}
