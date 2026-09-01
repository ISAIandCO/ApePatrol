import { normalizeAiChat } from "../shared/ai-chat.js";
import { indexedDbSessionStorage } from "./session-state.js";

const PREFIX = "apepatrolPopupTab:";

function sessionKey(tabId) {
  const id = Number(tabId);
  if (!Number.isInteger(id) || id <= 0) throw new TypeError("Invalid tab session ID");
  return `${PREFIX}${id}`;
}

export async function getTabSession(tabId, storageArea = indexedDbSessionStorage) {
  const key = sessionKey(tabId);
  let stored = (await storageArea.get(key))[key];
  if (!stored && storageArea === indexedDbSessionStorage) {
    const legacyKey = `apepatrol-popup-tab:${Number(tabId)}`;
    stored = (await browser.storage.session.get(legacyKey))[legacyKey];
    if (stored) {
      await storageArea.set({ [key]: stored });
      await browser.storage.session.remove(legacyKey);
    }
  }
  return {
    activePanel: typeof stored?.activePanel === "string" ? stored.activePanel : "event",
    aiChat: normalizeAiChat(stored?.aiChat),
  };
}

export async function saveTabSession(tabId, input, storageArea = indexedDbSessionStorage) {
  const key = sessionKey(tabId);
  const session = {
    activePanel: typeof input?.activePanel === "string" ? input.activePanel.slice(0, 80) : "event",
    aiChat: normalizeAiChat(input?.aiChat),
  };
  await storageArea.set({ [key]: session });
  return session;
}

export async function deleteTabSession(tabId, storageArea = indexedDbSessionStorage) {
  await storageArea.remove(sessionKey(tabId));
  return true;
}
