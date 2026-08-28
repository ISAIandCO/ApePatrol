import { describe, expect, it, vi } from "vitest";
import { createSiemBackgroundFetch } from "../src/content/siem-transport.js";

describe("content-to-background SIEM transport", () => {
  it("forwards only the relative API path and reconstructs the response", async () => {
    const runtime = {
      sendMessage: vi.fn(async () => ({
        ok: true,
        response: { status: 200, statusText: "OK", contentType: "application/json", bodyText: '{"events":[]}' },
      })),
    };
    const fetchImpl = createSiemBackgroundFetch(runtime);
    const response = await fetchImpl(new URL("https://siem.example/api/events/v2/events?limit=10"), {
      method: "POST",
      body: '{"filter":{}}',
      signal: new AbortController().signal,
    });

    expect(runtime.sendMessage).toHaveBeenCalledWith({
      type: "siem:api",
      path: "/api/events/v2/events?limit=10",
      method: "POST",
      body: '{"filter":{}}',
    });
    expect(await response.json()).toEqual({ events: [] });
  });

  it("does not bind an in-flight background request to the page AbortSignal", async () => {
    const controller = new AbortController();
    const runtime = {
      sendMessage: vi.fn(async () => {
        controller.abort();
        return { ok: true, response: { status: 204, statusText: "No Content", contentType: "", bodyText: "" } };
      }),
    };
    const response = await createSiemBackgroundFetch(runtime)("https://siem.example/api/events/v2/events_metadata", { signal: controller.signal });
    expect(response.status).toBe(204);
  });
});
