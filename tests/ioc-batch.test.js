import { beforeEach, describe, expect, it, vi } from "vitest";
import { cancelIocBatch, runIocBatch } from "../src/background/ioc-batch.js";
import {
  collectEventIocs,
  IOC_BATCH_CACHE_KEY,
  iocBatchCacheKey,
  normalizeIocBatchResult,
  readIocCache,
} from "../src/shared/ioc-batch.js";
import { DEFAULT_SETTINGS, LOCAL_SECRETS_KEY, SYNC_STORAGE_KEY } from "../src/shared/settings.js";

function storage(initial = {}) {
  const values = structuredClone(initial);
  return {
    values,
    get: vi.fn(async (keys) => {
      if (keys === null) return structuredClone(values);
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter((key) => key in values).map((key) => [key, structuredClone(values[key])]));
    }),
    set: vi.fn(async (updates) => Object.assign(values, structuredClone(updates))),
    remove: vi.fn(async () => {}),
  };
}

describe("batch IOC enrichment", () => {
  let sync;
  let local;
  beforeEach(() => {
    sync = storage({ [SYNC_STORAGE_KEY]: DEFAULT_SETTINGS });
    local = storage({ [LOCAL_SECRETS_KEY]: { virusTotalApiKey: "secret", abuseIpDbApiKey: "secret" } });
    globalThis.browser = { storage: { sync, local, managed: storage() } };
  });

  it("collects unique IOC values from an event", () => {
    const iocs = collectEventIocs({ "src.ip": "8.8.8.8", "dst.ip": "8.8.8.8", "file.hash": "d41d8cd98f00b204e9800998ecf8427e" });
    expect(iocs).toHaveLength(2);
    expect(iocs.find((ioc) => ioc.type === "ip").fields).toEqual(["src.ip", "dst.ip"]);
  });

  it("keeps provider models normalized without inventing a malicious boolean", () => {
    const job = { provider: "abuseipdb", ioc: { type: "ip", value: "8.8.8.8" } };
    const result = normalizeIocBatchResult(job, { provider: "AbuseIPDB", verdict: "suspicious", summary: "score", details: { score: 25 } }, { checkedAt: 10, ttlMs: 100 });
    expect(result).toMatchObject({ maliciousScore: 25, verdict: "suspicious", checkedAt: 10, expiresAt: 110 });
    expect(result).not.toHaveProperty("malicious");
  });

  it("uses TTL cache without placing API keys in the cache key or entry", async () => {
    const job = { provider: "virustotal", ioc: { type: "ip", value: "8.8.8.8" } };
    const lookup = vi.fn().mockResolvedValue({ provider: "VirusTotal", verdict: "clean-or-unknown", summary: "ok", details: {} });
    const first = await runIocBatch({ requestId: "11111111-1111", jobs: [job], confirmed: true }, { storageArea: local, permissionCheck: async () => true, lookup });
    const second = await runIocBatch({ requestId: "22222222-2222", jobs: [job], confirmed: true }, { storageArea: local, permissionCheck: async () => true, lookup });
    expect(first.summary.ok).toBe(1);
    expect(second.results[0].cached).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(local.values[IOC_BATCH_CACHE_KEY])).not.toContain("secret");
    expect(iocBatchCacheKey(job)).not.toContain("secret");
  });

  it("returns partial results when one provider fails", async () => {
    const jobs = [
      { provider: "virustotal", ioc: { type: "ip", value: "8.8.8.8" } },
      { provider: "abuseipdb", ioc: { type: "ip", value: "1.1.1.1" } },
    ];
    const lookup = vi.fn(async (provider) => {
      if (provider === "abuseipdb") throw Object.assign(new Error("denied"), { code: "PROVIDER_AUTH_FAILED" });
      return { provider: "VirusTotal", verdict: "clean-or-unknown", summary: "ok", details: {} };
    });
    const batch = await runIocBatch({ requestId: "33333333-3333", jobs, confirmed: true }, { storageArea: local, permissionCheck: async () => true, lookup });
    expect(batch.summary).toMatchObject({ ok: 1, errors: 1 });
    expect(batch.results.map((result) => result.status)).toEqual(expect.arrayContaining(["ok", "error"]));
  });

  it("returns a cancelled result when cancellation interrupts provider backoff", async () => {
    const requestId = "44444444-4444";
    const lookup = vi.fn(async () => {
      queueMicrotask(() => cancelIocBatch(requestId));
      throw Object.assign(new Error("rate limited"), { code: "PROVIDER_RATE_LIMIT", retryAfterMs: 30_000 });
    });
    const batch = await runIocBatch({
      requestId,
      jobs: [{ provider: "virustotal", ioc: { type: "ip", value: "8.8.8.8" } }],
      confirmed: true,
    }, { storageArea: local, permissionCheck: async () => true, lookup });
    expect(batch.summary).toMatchObject({ cancelled: 1, errors: 0 });
    expect(batch.results[0].status).toBe("cancelled");
  });

  it("expires cache entries", () => {
    const entry = { checkedAt: 1, expiresAt: 10 };
    expect(readIocCache({ key: entry }, "key", 9)).toEqual(entry);
    expect(readIocCache({ key: entry }, "key", 10)).toBeNull();
  });
});
