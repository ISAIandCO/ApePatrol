import { iocFromField } from "./ioc.js";

export const IOC_BATCH_CACHE_KEY = "apePatrolIocBatchCacheV1";
export const IOC_ADAPTER_VERSIONS = Object.freeze({ virustotal: 1, abuseipdb: 1, opentip: 1, threatfox: 1 });
export const IOC_BATCH_PROVIDERS = Object.freeze({
  virustotal: { name: "VirusTotal", types: ["ip", "hash", "domain", "url"] },
  abuseipdb: { name: "AbuseIPDB", types: ["ip"] },
  opentip: { name: "Kaspersky OpenTIP", types: ["ip", "hash", "domain", "url"] },
  threatfox: { name: "ThreatFox", types: ["ip", "hash", "domain", "url"] },
});

export function collectEventIocs(event) {
  const found = new Map();
  for (const [field, value] of Object.entries(event ?? {})) {
    const ioc = iocFromField(field, value);
    if (!ioc) continue;
    const key = `${ioc.type}:${ioc.value}`;
    const current = found.get(key) ?? { ...ioc, fields: [] };
    current.fields.push(field);
    found.set(key, current);
  }
  return [...found.values()].sort((first, second) => first.type.localeCompare(second.type) || first.value.localeCompare(second.value));
}

export function buildIocBatchJobs(iocs, providerDefinitions, selectedProviders) {
  const selected = new Set(selectedProviders);
  const jobs = [];
  for (const ioc of iocs) {
    for (const [provider, definition] of Object.entries(providerDefinitions)) {
      if (selected.has(provider) && definition.types.includes(ioc.type)) jobs.push({ provider, ioc: { type: ioc.type, value: ioc.value } });
    }
  }
  return jobs;
}

export function iocBatchCacheKey(job, relevantSettings = {}) {
  return JSON.stringify({
    provider: job.provider,
    adapterVersion: IOC_ADAPTER_VERSIONS[job.provider] ?? 1,
    iocType: job.ioc.type,
    ioc: job.ioc.value,
    settings: relevantSettings,
  });
}

export function normalizeIocBatchResult(job, result, { checkedAt = Date.now(), ttlMs = 3600000, cached = false } = {}) {
  const score = Number(result?.details?.score ?? result?.details?.reputation);
  const labels = result?.details?.categories && typeof result.details.categories === "object"
    ? Object.values(result.details.categories).flat().map(String).slice(0, 30)
    : [];
  return {
    provider: job.provider,
    providerName: result?.provider ?? job.provider,
    ioc: job.ioc.value,
    iocType: job.ioc.type,
    status: "ok",
    verdict: result?.verdict ?? "unknown",
    maliciousScore: Number.isFinite(score) ? score : null,
    labels,
    summary: String(result?.summary ?? "").slice(0, 1000),
    rawAvailable: Boolean(result?.details),
    details: result?.details ?? {},
    checkedAt,
    expiresAt: checkedAt + ttlMs,
    cached,
  };
}

export function readIocCache(cache, key, now = Date.now()) {
  const entry = cache?.[key];
  return entry && Number(entry.expiresAt) > now ? structuredClone(entry) : null;
}

export function pruneIocCache(cache, { now = Date.now(), maxEntries = 500 } = {}) {
  return Object.fromEntries(Object.entries(cache ?? {})
    .filter(([, entry]) => Number(entry?.expiresAt) > now)
    .sort((first, second) => Number(second[1].checkedAt) - Number(first[1].checkedAt))
    .slice(0, maxEntries));
}
