const GROUPS = Object.freeze([
  ["process", /(^|\.)(process|cmdline|executable|image|pid|ppid|hash)(\.|$)/i],
  ["network", /(^|\.)(src|dst|source|destination|ip|port|domain|url|dns|protocol)(\.|$)/i],
  ["account", /(^|\.)(account|user|subject)(\.|$)/i],
  ["host", /(^|\.)(host|hostname|asset)(\.|$)/i],
  ["rule", /(rule|correlation|incident|severity|category)/i],
]);

export function normalizeCompareFieldName(name) {
  return String(name ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function compareFieldGroup(field) {
  return GROUPS.find(([, pattern]) => pattern.test(field))?.[0] ?? "raw";
}

function canonicalValue(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  const result = Array.isArray(value)
    ? value.map((item) => canonicalValue(item, seen))
    : Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key], seen)]));
  seen.delete(value);
  return result;
}

function stableValue(value) {
  return value === undefined ? undefined : JSON.stringify(canonicalValue(value));
}

export function compareEvents(events) {
  if (!Array.isArray(events) || events.length < 2 || events.length > 3) throw new TypeError("Compare requires two or three events");
  const normalized = events.map((event) => Object.fromEntries(Object.entries(event ?? {}).map(([key, value]) => [normalizeCompareFieldName(key), value])));
  const fields = [...new Set(normalized.flatMap(Object.keys))].sort();
  const rows = fields.map((field) => {
    const values = normalized.map((event) => event[field]);
    const present = values.map((value) => value !== undefined);
    const serialized = values.filter((value) => value !== undefined).map(stableValue);
    const status = present.every(Boolean) && new Set(serialized).size === 1 ? "same"
      : present.every(Boolean) ? "changed"
        : "only";
    return { field, group: compareFieldGroup(field), status, present, values };
  });
  return { eventCount: events.length, rows, groups: Object.groupBy(rows, (row) => row.group) };
}

export function eventDiffToMarkdown(diff, labels = []) {
  const lines = ["# Event comparison", ""];
  for (const group of ["process", "network", "account", "host", "rule", "raw"]) {
    const rows = diff.groups[group] ?? [];
    if (!rows.length) continue;
    lines.push(`## ${group}`, "", `| Field | Status | ${Array.from({ length: diff.eventCount }, (_, index) => labels[index] || `Event ${index + 1}`).join(" | ")} |`, `|---|---|${Array.from({ length: diff.eventCount }, () => "---").join("|")}|`);
    for (const row of rows) lines.push(`| ${row.field} | ${row.status} | ${row.values.map((value) => value === undefined ? "—" : String(value).replace(/\|/g, "\\|").slice(0, 500)).join(" | ")} |`);
    lines.push("");
  }
  return lines.join("\n");
}
