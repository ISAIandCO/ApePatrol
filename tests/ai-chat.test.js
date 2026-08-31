import { describe, expect, it } from "vitest";
import { AI_CHAT_MAX_BYTES, addAiAttachment, appendAiMessage, eventAiAttachment, mergeAiChats, normalizeAiChat } from "../src/shared/ai-chat.js";

describe("AI chat state", () => {
  it("deduplicates a pending event while preserving one tab conversation", () => {
    const event = eventAiAttachment({ uuid: "event-1", time: "2026-08-31T10:00:00Z", correlation_name: "Rule" });
    const first = addAiAttachment({}, event);
    const second = addAiAttachment(first, { ...event, snapshot: { uuid: "event-1", severity: "high" } });
    expect(second.pendingAttachments).toHaveLength(1);
    expect(second.pendingAttachments[0].snapshot.severity).toBe("high");
  });

  it("merges a tab conversation into a workspace without duplicating message IDs", () => {
    const source = appendAiMessage({}, { id: "message-1", role: "user", content: "Investigate" });
    const target = appendAiMessage({}, { id: "message-1", role: "user", content: "Investigate" });
    expect(mergeAiChats(target, source).messages).toHaveLength(1);
  });

  it("rejects unsupported roles and strips secret-like attachment fields", () => {
    const chat = normalizeAiChat({ messages: [{ role: "system", content: "bad" }, { role: "user", content: "ok", attachments: [{ type: "event", value: "1", snapshot: { host: "pc", apiToken: "secret" } }] }] });
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].attachments[0].snapshot).toEqual({ host: "pc" });
  });

  it("drops oversized historical context instead of losing the chat", () => {
    const attachments = Array.from({ length: 8 }, (_, index) => ({
      type: "note", value: String(index), snapshot: { value: "x".repeat(400_000) },
    }));
    const chat = normalizeAiChat({ messages: [{ role: "user", content: "Investigate", attachments }] });
    expect(new TextEncoder().encode(JSON.stringify(chat)).byteLength).toBeLessThanOrEqual(AI_CHAT_MAX_BYTES);
    expect(chat.messages).toHaveLength(1);
    expect(chat.messages[0].attachments.length).toBeLessThan(8);
  });

  it("recovers from malformed persisted attachments", () => {
    const chat = normalizeAiChat({ pendingAttachments: [null, { type: "event", value: "ok", snapshot: {} }] });
    expect(chat.pendingAttachments.map((item) => item.value)).toEqual(["ok"]);
  });
});
