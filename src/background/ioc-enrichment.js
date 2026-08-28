import { extractPreferredHash } from "../shared/hash.js";
import { normalizeIoc } from "../shared/ioc.js";
import { classifyIp } from "../shared/ip.js";

export const IOC_API_PROVIDERS = Object.freeze({
  virustotal: { name: "VirusTotal", origin: "https://www.virustotal.com/*", secret: "virusTotalApiKey", types: ["ip", "hash", "domain", "url"] },
  abuseipdb: { name: "AbuseIPDB", origin: "https://api.abuseipdb.com/*", secret: "abuseIpDbApiKey", types: ["ip"] },
  opentip: { name: "Kaspersky OpenTIP", origin: "https://opentip.kaspersky.com/*", secret: "openTipApiKey", types: ["ip", "hash", "domain", "url"] },
  threatfox: { name: "ThreatFox", origin: "https://threatfox-api.abuse.ch/*", secret: "threatFoxApiKey", types: ["ip", "hash", "domain", "url"] },
});

function verdictFromStats(stats = {}) {
  if ((stats.malicious ?? 0) > 0) return "malicious";
  if ((stats.suspicious ?? 0) > 0) return "suspicious";
  return "clean-or-unknown";
}

function base64Url(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function safeDetail(text) {
  const compact = String(text ?? "").replace(/\s+/g, " ").trim();
  return /[<>]/.test(compact) ? "" : compact.slice(0, 300);
}

async function requestJson(url, options, fetchImpl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const text = await response.text();
    if (!response.ok) {
      let detail = safeDetail(text);
      try {
        const body = JSON.parse(text);
        detail = safeDetail(body?.error?.message ?? body?.errors?.[0]?.detail ?? body?.message ?? detail);
      } catch { /* Plain response already handled. */ }
      throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
    }
    try { return JSON.parse(text); } catch { throw new Error(`${new URL(url).hostname} returned invalid JSON`); }
  } finally {
    clearTimeout(timer);
  }
}

async function virusTotal(ioc, key, fetchImpl) {
  const resource = ioc.type === "hash" ? `files/${ioc.value}`
    : ioc.type === "ip" ? `ip_addresses/${ioc.value}`
      : ioc.type === "domain" ? `domains/${ioc.value}`
        : `urls/${base64Url(ioc.value)}`;
  const body = await requestJson(`https://www.virustotal.com/api/v3/${resource}`, { headers: { "x-apikey": key, Accept: "application/json" } }, fetchImpl);
  const attributes = body?.data?.attributes ?? {};
  const stats = attributes.last_analysis_stats ?? {};
  return {
    provider: "VirusTotal",
    verdict: verdictFromStats(stats),
    summary: `malicious: ${stats.malicious ?? 0}, suspicious: ${stats.suspicious ?? 0}, harmless: ${stats.harmless ?? 0}, undetected: ${stats.undetected ?? 0}`,
    details: { reputation: attributes.reputation ?? null, categories: attributes.categories ?? {}, lastAnalysisStats: stats },
  };
}

async function abuseIpDb(ioc, key, fetchImpl) {
  const url = new URL("https://api.abuseipdb.com/api/v2/check");
  url.searchParams.set("ipAddress", ioc.value);
  url.searchParams.set("maxAgeInDays", "90");
  const body = await requestJson(url, { headers: { Key: key, Accept: "application/json" } }, fetchImpl);
  const data = body?.data ?? {};
  const score = Number(data.abuseConfidenceScore ?? 0);
  return {
    provider: "AbuseIPDB",
    verdict: score >= 75 ? "malicious" : score > 0 ? "suspicious" : "clean-or-unknown",
    summary: `abuse score: ${score}%, reports: ${data.totalReports ?? 0}, country: ${data.countryCode ?? "?"}, ISP: ${data.isp ?? "?"}`,
    details: { score, totalReports: data.totalReports ?? 0, lastReportedAt: data.lastReportedAt ?? null, usageType: data.usageType ?? null, isTor: data.isTor ?? false },
  };
}

async function openTip(ioc, key, fetchImpl) {
  const endpoint = ioc.type === "hash" ? "hash" : ioc.type === "ip" ? "ip" : ioc.type === "domain" ? "domain" : "url";
  const url = new URL(`https://opentip.kaspersky.com/api/v1/search/${endpoint}`);
  url.searchParams.set("request", ioc.value);
  const body = await requestJson(url, { headers: { "x-api-key": key, Accept: "application/json" } }, fetchImpl);
  const zone = String(body?.Zone ?? "Grey");
  const verdict = ["Red", "Orange"].includes(zone) ? "malicious" : zone === "Yellow" ? "suspicious" : "clean-or-unknown";
  const info = body.FileGeneralInfo ?? body.IpGeneralInfo ?? body.DomainGeneralInfo ?? body.UrlGeneralInfo ?? {};
  return {
    provider: "Kaspersky OpenTIP",
    verdict,
    summary: `zone: ${zone}, status: ${info.FileStatus ?? info.Status ?? body.Status ?? "unknown"}, hits: ${info.HitsCount ?? body.HitsCount ?? "?"}`,
    details: { zone, status: info.FileStatus ?? info.Status ?? body.Status ?? null, categories: info.Categories ?? body.Categories ?? [], firstSeen: info.FirstSeen ?? body.FirstSeen ?? null, lastSeen: info.LastSeen ?? body.LastSeen ?? null },
  };
}

async function threatFox(ioc, key, fetchImpl) {
  const isSupportedHash = ioc.type === "hash" && [32, 64].includes(ioc.value.length);
  const request = isSupportedHash
    ? { query: "search_hash", hash: ioc.value }
    : { query: "search_ioc", search_term: ioc.value, exact_match: true };
  const body = await requestJson("https://threatfox-api.abuse.ch/api/v1/", {
    method: "POST",
    headers: { "Auth-Key": key, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }, fetchImpl);
  const results = Array.isArray(body?.data) ? body.data : [];
  const top = results[0] ?? {};
  return {
    provider: "ThreatFox",
    verdict: results.length ? "malicious" : "clean-or-unknown",
    summary: results.length ? `совпадений: ${results.length}, malware: ${top.malware_printable ?? top.malware ?? "?"}, confidence: ${top.confidence_level ?? "?"}%` : `совпадений нет (${body?.query_status ?? "unknown"})`,
    details: { queryStatus: body?.query_status ?? null, matches: results.slice(0, 10).map((item) => ({ ioc: item.ioc, type: item.ioc_type, malware: item.malware_printable ?? item.malware, confidence: item.confidence_level, firstSeen: item.first_seen, lastSeen: item.last_seen })) },
  };
}

export async function lookupIoc(providerId, input, secrets, { fetchImpl = fetch } = {}) {
  const provider = IOC_API_PROVIDERS[providerId];
  if (!provider) throw new Error("Unknown IOC provider");
  const value = normalizeIoc(input?.type, input?.value);
  if (!value || !provider.types.includes(input.type)) throw new Error(`${provider.name} does not support this IOC type`);
  if (input.type === "ip" && classifyIp(value) !== "public") throw new Error("Private, reserved and local IP addresses are not sent to external providers");
  if (input.type === "hash" && !extractPreferredHash(value)) throw new Error("Invalid file hash");
  const key = secrets[provider.secret];
  if (!key) throw new Error(`${provider.name} API key is not configured`);
  const ioc = { type: input.type, value };
  const result = providerId === "virustotal" ? await virusTotal(ioc, key, fetchImpl)
    : providerId === "abuseipdb" ? await abuseIpDb(ioc, key, fetchImpl)
      : providerId === "opentip" ? await openTip(ioc, key, fetchImpl)
        : await threatFox(ioc, key, fetchImpl);
  return { ...result, type: ioc.type, value: ioc.value };
}
