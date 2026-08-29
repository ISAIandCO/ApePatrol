import { describe, expect, it, vi } from "vitest";
import { lookupIoc } from "../src/background/ioc-enrichment.js";

const response = (body, status = 200, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
  text: async () => JSON.stringify(body),
});

describe("IOC API enrichment", () => {
  it("normalizes a VirusTotal hash response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ data: { attributes: { reputation: -2, last_analysis_stats: { malicious: 2, suspicious: 1, harmless: 8, undetected: 50 } } } }));
    const result = await lookupIoc("virustotal", { type: "hash", value: "d41d8cd98f00b204e9800998ecf8427e" }, { virusTotalApiKey: "key" }, { fetchImpl });
    expect(result).toMatchObject({ provider: "VirusTotal", verdict: "malicious", type: "hash" });
    expect(fetchImpl.mock.calls[0][0]).toContain("/api/v3/files/");
    expect(fetchImpl.mock.calls[0][1].headers["x-apikey"]).toBe("key");
  });

  it("uses the documented AbuseIPDB endpoint and headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ data: { abuseConfidenceScore: 82, totalReports: 12, countryCode: "US" } }));
    const result = await lookupIoc("abuseipdb", { type: "ip", value: "8.8.8.8" }, { abuseIpDbApiKey: "key" }, { fetchImpl });
    expect(result.verdict).toBe("malicious");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("api/v2/check");
    expect(fetchImpl.mock.calls[0][1].headers.Key).toBe("key");
  });

  it("never sends private IP addresses to an external provider", async () => {
    const fetchImpl = vi.fn();
    await expect(lookupIoc("abuseipdb", { type: "ip", value: "192.168.1.1" }, { abuseIpDbApiKey: "key" }, { fetchImpl })).rejects.toThrow("not sent");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires the provider key before making a request", async () => {
    const fetchImpl = vi.fn();
    await expect(lookupIoc("opentip", { type: "domain", value: "example.com" }, {}, { fetchImpl })).rejects.toThrow("API key is not configured");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses ThreatFox search_ioc for domains", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ query_status: "ok", data: [{ ioc: "evil.example", malware_printable: "Example", confidence_level: 90 }] }));
    const result = await lookupIoc("threatfox", { type: "domain", value: "evil.example" }, { threatFoxApiKey: "key" }, { fetchImpl });
    expect(result.verdict).toBe("malicious");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ query: "search_ioc", search_term: "evil.example" });
  });

  it("classifies provider throttling and preserves Retry-After", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response({ message: "slow down" }, 429, { "retry-after": "2" }));
    await expect(lookupIoc("virustotal", { type: "domain", value: "example.com" }, { virusTotalApiKey: "key" }, { fetchImpl }))
      .rejects.toMatchObject({ code: "PROVIDER_RATE_LIMIT", status: 429, retryAfterMs: 2000 });
  });
});
