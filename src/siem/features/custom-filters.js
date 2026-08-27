import { escapePdqlString, formatPdqlValue } from "../../shared/pdql/escape.js";

export const BUILTIN_FILTERS = Object.freeze([
  { id: "host-events", name: "All events on host", template: "event_src.host = '${event_src.host}'", timeRange: "15m", enabled: true },
  { id: "account-events", name: "Account as subject or object", template: "(subject.account.name = '${subject.account.name}') or (object.account.name = '${subject.account.name}')", timeRange: "1h", enabled: true },
  { id: "ip-connections", name: "Network connections involving source IP", template: "(src.ip = '${src.ip}') or (dst.ip = '${src.ip}')", timeRange: "1h", enabled: true },
  { id: "process-guid", name: "Events for process GUID", template: "(subject.process.guid = '${object.process.guid}') or (object.process.guid = '${object.process.guid}')", timeRange: "1h", enabled: true },
  { id: "file-on-host", name: "File events on host", template: "(event_src.host = '${event_src.host}') and (object.name = '${object.name}')", timeRange: "24h", enabled: true },
]);

const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_.]*)\}/g;

export function requiredTemplateFields(template) {
  return [...new Set([...String(template).matchAll(PLACEHOLDER)].map((match) => match[1]))];
}

export function renderFilterTemplate(template, event) {
  const missing = requiredTemplateFields(template).filter((field) => event[field] === undefined || event[field] === null || event[field] === "");
  if (missing.length) return { ok: false, missing, query: null };
  const query = String(template).replace(PLACEHOLDER, (match, field, offset, source) => {
    const value = event[field];
    const quoted = source[offset - 1] === "'" && source[offset + match.length] === "'";
    return quoted ? escapePdqlString(value) : formatPdqlValue(value);
  });
  return { ok: true, missing: [], query };
}

export function normalizeCustomFilter(filter, index = 0) {
  if (!filter || typeof filter !== "object" || typeof filter.template !== "string") return null;
  const requiredFields = requiredTemplateFields(filter.template);
  if (!requiredFields.length || filter.template.length > 4000) return null;
  return {
    id: String(filter.id || `filter-${index}`).replace(/[^a-z0-9_-]/gi, "-").slice(0, 64),
    name: String(filter.name || `Filter ${index + 1}`).slice(0, 120),
    template: filter.template,
    requiredFields,
    timeRange: ["5m", "15m", "1h", "24h"].includes(filter.timeRange) ? filter.timeRange : "15m",
    enabled: filter.enabled !== false,
  };
}
