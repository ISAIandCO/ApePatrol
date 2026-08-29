import { describe, expect, it, vi } from "vitest";
import { proxySiemApiRequest, resolveAllowedSiemApiUrl, resolveAllowedSiemMutationUrl } from "../src/background/siem-proxy.js";

describe("background SIEM API proxy", () => {
  it("allows only the declared method and same-origin API route", () => {
    expect(resolveAllowedSiemApiUrl("https://siem.example", "/api/events/v2/events?limit=1000", "POST").href)
      .toBe("https://siem.example/api/events/v2/events?limit=1000");
    expect(() => resolveAllowedSiemApiUrl("https://siem.example", "/api/events/v2/events", "DELETE")).toThrow("not allowed");
    expect(() => resolveAllowedSiemApiUrl("https://siem.example", "//evil.example/api/events/v2/events", "POST")).toThrow("Invalid");
    expect(() => resolveAllowedSiemApiUrl("https://siem.example", "/api/unknown", "GET")).toThrow("not allowed");
    expect(() => resolveAllowedSiemApiUrl("https://siem.example", "/api/whitelists/list/insert", "POST")).toThrow("not allowed");
    expect(resolveAllowedSiemMutationUrl("https://siem.example", "/api/whitelists/list/insert", "POST").pathname).toBe("/api/whitelists/list/insert");
  });

  it("performs the authenticated read in the extension background", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ events: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const body = JSON.stringify({ filter: { where: "msgid = 1" } });
    await expect(proxySiemApiRequest("https://siem.example", {
      path: "/api/events/v2/events?limit=1000&offset=0",
      method: "POST",
      body,
    }, { fetchImpl })).resolves.toMatchObject({ status: 200, contentType: "application/json" });

    const [url, options] = fetchImpl.mock.calls[0];
    expect(url.href).toBe("https://siem.example/api/events/v2/events?limit=1000&offset=0");
    expect(options).toMatchObject({ method: "POST", credentials: "include", redirect: "error", body });
  });

  it("uses the original extension-style XHR transport when available", async () => {
    const xhr = {
      headers: {},
      open: vi.fn(),
      setRequestHeader(name, value) { this.headers[name] = value; },
      getResponseHeader: () => "application/json",
      send: vi.fn(function send() {
        this.status = 200;
        this.statusText = "OK";
        this.responseURL = "https://siem.example/api/events/v2/events?limit=1000";
        this.responseText = '{"events":[]}';
        this.onload();
      }),
    };
    const fetchImpl = vi.fn();
    const result = await proxySiemApiRequest("https://siem.example", {
      path: "/api/events/v2/events?limit=1000",
      method: "POST",
      body: '{"filter":{}}',
    }, { fetchImpl, xhrFactory: () => xhr });

    expect(result).toMatchObject({ status: 200, bodyText: '{"events":[]}' });
    expect(xhr.open).toHaveBeenCalledWith("POST", "https://siem.example/api/events/v2/events?limit=1000");
    expect(xhr.withCredentials).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects non-JSON and oversized-style request shapes before network access", async () => {
    const fetchImpl = vi.fn();
    await expect(proxySiemApiRequest("https://siem.example", {
      path: "/api/events/v2/events",
      method: "POST",
      body: "not json",
    }, { fetchImpl })).rejects.toBeInstanceOf(SyntaxError);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(proxySiemApiRequest("https://siem.example", {
      path: "/api/events/v2/events",
      method: "POST",
      body: JSON.stringify("я".repeat(3 * 1024 * 1024)),
    }, { fetchImpl })).rejects.toThrow("too large");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an XHR redirect outside the configured SIEM origin", async () => {
    const xhr = {
      open: vi.fn(),
      setRequestHeader: vi.fn(),
      getResponseHeader: () => "application/json",
      send: vi.fn(function send() {
        this.status = 200;
        this.responseURL = "https://evil.example/api/events/v2/events";
        this.responseText = '{"events":[]}';
        this.onload();
      }),
    };
    await expect(proxySiemApiRequest("https://siem.example", {
      path: "/api/events/v2/events?limit=1",
      method: "POST",
      body: '{"filter":{}}',
    }, { xhrFactory: () => xhr })).rejects.toThrow("redirected outside");
  });
});
