import { parseSafeExternalUrl } from "../../shared/url.js";

function objects(value, output = []) {
  if (!value || typeof value !== "object" || output.length > 2000) return output;
  if (Array.isArray(value)) for (const item of value) objects(item, output);
  else {
    output.push(value);
    for (const item of Object.values(value)) objects(item, output);
  }
  return output;
}

export function resolveKnowledgeBaseUrl(applications, rule) {
  const objectId = rule?.objectId ?? rule?.id;
  if (!objectId) return null;
  for (const app of objects(applications)) {
    const label = [app.name, app.title, app.displayName, app.product].filter(Boolean).join(" ").toLowerCase();
    if (!/knowledge|pt\s*kb|баз[аы]\s+знаний/.test(label)) continue;
    const base = [app.url, app.baseUrl, app.href, app.address].map((value) => parseSafeExternalUrl(value)).find(Boolean);
    if (!base) continue;
    const route = `/#/siem/${encodeURIComponent(objectId)}`;
    return new URL(route, base.origin).href;
  }
  return null;
}
