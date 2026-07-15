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

export async function startExtractionState(storage, lastInput, startedAt) {
  await Promise.all([
    storage.local.set({ lastInput: String(lastInput || "").trim() }),
    storage.session.set({
      extractState: {
        status: "loading",
        startedAt
      }
    })
  ]);
}

export async function persistExtractionState(storage, extractState) {
  await storage.session.set({ extractState });
}
