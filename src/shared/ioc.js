import { extractPreferredHash } from "./hash.js";
import { classifyIp } from "./ip.js";
import { parseSafeExternalUrl } from "./url.js";

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z](?:[a-z\d-]{0,61}[a-z\d])?$/i;

export function normalizeIoc(type, rawValue) {
  const value = String(rawValue ?? "").trim();
  if (!value) return null;
  if (type === "hash") return extractPreferredHash(value);
  if (type === "ip") return classifyIp(value) === "invalid" ? null : value;
  if (type === "domain") return DOMAIN_PATTERN.test(value) ? value.toLowerCase() : null;
  if (type === "url") return parseSafeExternalUrl(value)?.href ?? null;
  return null;
}

export function iocFromField(field, rawValue) {
  const name = String(field).toLowerCase();
  const candidates = [];
  if (name.endsWith("hash")) candidates.push("hash");
  if (name.endsWith(".ip") || name === "ip") candidates.push("ip");
  if (name.includes("url") || name === "external_link") candidates.push("url");
  if (name.endsWith(".domain") || name.endsWith(".fqdn") || name === "domain" || name === "dns.query") candidates.push("domain");
  for (const type of candidates) {
    const value = normalizeIoc(type, rawValue);
    if (value) return { type, value };
  }
  return null;
}
