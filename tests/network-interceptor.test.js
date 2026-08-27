// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalFetch = window.fetch;
const fetchMock = vi.fn(async () => ({ ok: true }));

beforeAll(async () => {
  window.fetch = fetchMock;
  await import("../src/page-bridge/network-interceptor.js");
});

afterAll(() => {
  window[Symbol.for("siem-monkey.network-interceptor.v3")]?.unpatch();
  window.fetch = originalFetch;
});

function bridgeMessage(data) {
  window.dispatchEvent(new MessageEvent("message", { source: window, origin: location.origin, data: { source: "siem-monkey", ...data } }));
}

describe("narrow MAIN-world network bridge", () => {
  it("does not touch unrelated traffic", async () => {
    bridgeMessage({ type: "bridge-config", iocDescription: true });
    bridgeMessage({ type: "ioc-description", token: "list-1", description: "desc", username: "analyst", expiresAt: Date.now() + 10000 });
    const body = JSON.stringify(["value", "type", "old"]);
    await window.fetch("/api/events/v2/events", { method: "POST", body });
    expect(fetchMock.mock.lastCall[1].body).toBe(body);
  });

  it("transforms one exact IOC insertion and consumes state", async () => {
    const body = JSON.stringify(["value", "type", "old"]);
    await window.fetch("/api/whitelists/list-1/insert", { method: "POST", body });
    expect(JSON.parse(fetchMock.mock.lastCall[1].body)[2]).toBe("desc (analyst)");
    await window.fetch("/api/whitelists/list-1/insert", { method: "POST", body });
    expect(fetchMock.mock.lastCall[1].body).toBe(body);
  });

  it("leaves malformed payloads intact", async () => {
    bridgeMessage({ type: "ioc-description", token: "list-1", description: "desc", username: "analyst", expiresAt: Date.now() + 10000 });
    await window.fetch("/api/whitelists/list-1/insert", { method: "POST", body: "not-json" });
    expect(fetchMock.mock.lastCall[1].body).toBe("not-json");
  });
});
