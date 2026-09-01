import { describe, expect, it } from "vitest";
import { deleteTabSession, getTabSession, saveTabSession } from "../src/background/tab-sessions.js";

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(key) { return Object.hasOwn(data, key) ? { [key]: data[key] } : {}; },
    async set(values) { Object.assign(data, values); },
    async remove(key) { delete data[key]; },
  };
}

describe("per-tab popup sessions", () => {
  it("stores chat state outside browser.storage.session and removes it with the tab", async () => {
    const storage = memoryStorage();
    await saveTabSession(42, { activePanel: "ai", aiChat: { messages: [{ role: "assistant", content: "**ready**" }] } }, storage);
    await expect(getTabSession(42, storage)).resolves.toMatchObject({ activePanel: "ai", aiChat: { messages: [{ content: "**ready**" }] } });
    await deleteTabSession(42, storage);
    await expect(getTabSession(42, storage)).resolves.toMatchObject({ activePanel: "event", aiChat: { messages: [] } });
  });
});
