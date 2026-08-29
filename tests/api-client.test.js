import { describe, expect, it, vi } from "vitest";
import { SiemApiClient, SiemApiError } from "../src/siem/api/client.js";

describe("SIEM API client", () => {
  it("matches the MP SIEM JSON request shape and charset", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ events: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    const client = new SiemApiClient("https://siem.example", { fetchImpl });
    await client.searchEvents({
      where: "msgid in [1, 4688]",
      select: ["uuid", "time"],
      timeFrom: 100,
      timeTo: 200,
    });

    const [, request] = fetchImpl.mock.calls[0];
    expect(request.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(JSON.parse(request.body)).toMatchObject({
      filter: { select: ["uuid", "time"], where: "msgid in [1, 4688]" },
      groupValues: null,
      timeFrom: 100,
      timeTo: 200,
    });
  });

  it("preserves a concise JSON server error", async () => {
    const client = new SiemApiClient("https://siem.example", {
      fetchImpl: async () => new Response(JSON.stringify({ message: "Invalid PDQL field" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    });
    await expect(client.searchEvents({ where: "bad", select: ["uuid"] })).rejects.toMatchObject({
      name: "SiemApiError",
      kind: "http",
      status: 400,
      message: expect.stringContaining("Invalid PDQL field"),
    });
  });

  it("reports the underlying network failure without leaking request data", async () => {
    const client = new SiemApiClient("https://siem.example", { fetchImpl: async () => { throw new TypeError("NetworkError"); } });
    await expect(client.getEventMetadata()).rejects.toEqual(expect.objectContaining({
      name: "SiemApiError",
      kind: "network",
      message: "GET /api/events/v2/events_metadata failed: NetworkError",
    }));
    expect(SiemApiError.prototype).toBeInstanceOf(Error);
  });

  it("falls back to authenticated XHR for a read-only event search", async () => {
    const xhr = {
      headers: {},
      open: vi.fn(),
      setRequestHeader(name, value) { this.headers[name] = value; },
      getResponseHeader: () => "application/json",
      send: vi.fn(function send() {
        this.status = 200;
        this.responseText = JSON.stringify({ events: [{ id: 1 }] });
        this.onload();
      }),
      abort: vi.fn(),
    };
    const client = new SiemApiClient("https://siem.example", {
      fetchImpl: async () => { throw new TypeError("NetworkError"); },
      xhrFactory: () => xhr,
    });

    await expect(client.searchEvents({ where: "msgid = 1", select: ["uuid"] })).resolves.toEqual({ events: [{ id: 1 }] });
    expect(xhr.open).toHaveBeenCalledWith("POST", new URL("https://siem.example/api/events/v2/events?limit=1000&offset=0"));
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers["Content-Type"]).toBe("application/json; charset=utf-8");
  });

});
