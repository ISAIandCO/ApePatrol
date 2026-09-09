import { normalizeIoc } from "@isaiandco/ape-share-core/ioc/normalize";
export { normalizeIoc } from "@isaiandco/ape-share-core/ioc/normalize";

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
