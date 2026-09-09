import { afterEach, describe, expect, it, vi } from "vitest";
import { requestAiCompletion } from "../src/shared/ai-request.js";
import { prepareAiRequest } from "../src/shared/ai-payload.js";
import { DEFAULT_SETTINGS, LOCAL_SECRETS_KEY, SYNC_STORAGE_KEY } from "../src/shared/settings.js";

function storage(values = {}) {
  return { get: vi.fn(async (keys) => {
    if (keys === null) return values;
    if (typeof keys === "string") return { [keys]: values[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
    return {};
  }), set: vi.fn(), remove: vi.fn() };
}

describe("visible-page AI request", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the reviewed payload without a long-lived runtime message", async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.features.aiAssistant = true;
    settings.ai = { ...settings.ai, endpoint: "http://127.0.0.1:8080/v1/chat/completions", model: "local" };
    const local = storage({ [SYNC_STORAGE_KEY]: settings, [LOCAL_SECRETS_KEY]: { llmApiKey: "secret" } });
    vi.stubGlobal("browser", {
      storage: { local, sync: storage(), managed: storage() },
      permissions: { contains: vi.fn(async () => true), getAll: vi.fn(async () => ({ data_collection: ["websiteContent", "authenticationInfo"] })) },
    });
    const event = { uuid: "event-1", time: "2026-09-09T00:00:00Z" };
    const conversation = [{ role: "user", content: "Что произошло?" }];
    const prepared = await prepareAiRequest(event, settings.ai, { conversation, contextType: "tab" });
    const fetchMock = vi.fn(async (_url, options) => {
      expect(options.body).toBe(prepared.serialized);
      return Response.json({ choices: [{ message: { content: "Ответ" } }] });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestAiCompletion({ event, conversation, contextType: "tab", previewHash: prepared.hash, confirmed: true });

    expect(result.content).toBe("Ответ");
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
