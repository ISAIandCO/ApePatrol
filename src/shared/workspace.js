import { normalizeOrigin } from "./url.js";

export const WORKSPACE_SCHEMA_VERSION = 1;
export const WORKSPACE_ITEM_TYPES = Object.freeze(["event", "process", "ioc", "host", "account", "incident", "note"]);
export const WORKSPACE_MAX_ITEM_BYTES = 1024 * 1024;
export const WORKSPACE_MAX_BYTES = 20 * 1024 * 1024;
const SECRET_KEY = /(password|passwd|token|api.?key|authorization|cookie|secret|private.?key|credential)/i;

function cleanText(value, maximum = 500) { return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, maximum); }

export function sanitizeWorkspaceSnapshot(value, depth = 0) {
  if (depth > 8) return "[maximum depth]";
  if (value === null || ["boolean", "number"].includes(typeof value)) return value;
  if (typeof value === "string") return value.slice(0, 20_000);
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => sanitizeWorkspaceSnapshot(item, depth + 1));
  if (!value || typeof value !== "object") return String(value ?? "");
  return Object.fromEntries(Object.entries(value).slice(0, 1000)
    .filter(([key]) => !SECRET_KEY.test(key))
    .map(([key, item]) => [cleanText(key, 200), sanitizeWorkspaceSnapshot(item, depth + 1)]));
}

export function normalizeWorkspaceItem(input, now = Date.now()) {
  const type = WORKSPACE_ITEM_TYPES.includes(input?.type) ? input.type : null;
  const value = cleanText(input?.value ?? input?.id, 2000);
  if (!type || !value) throw new TypeError("Workspace item requires a supported type and value");
  const item = {
    type,
    value,
    label: cleanText(input.label || value, 300),
    sourceEventUuid: cleanText(input.sourceEventUuid, 200) || null,
    snapshot: sanitizeWorkspaceSnapshot(input.snapshot ?? {}),
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
  };
  if (new TextEncoder().encode(JSON.stringify(item)).byteLength > WORKSPACE_MAX_ITEM_BYTES) throw new TypeError("Workspace item snapshot exceeds 1 MiB");
  return item;
}

export function createWorkspace(input = {}, now = Date.now(), uuid = crypto.randomUUID()) {
  const origin = input.siemOrigin ? normalizeOrigin(input.siemOrigin) : null;
  if (input.siemOrigin && !origin) throw new TypeError("Workspace SIEM origin is invalid");
  return {
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    id: String(uuid),
    title: cleanText(input.title || "Новое расследование", 160),
    createdAt: now,
    updatedAt: now,
    siemOrigin: origin,
    sourceIncidentId: cleanText(input.sourceIncidentId, 200) || null,
    items: [],
    notes: cleanText(input.notes, 100_000),
    tags: [...new Set((Array.isArray(input.tags) ? input.tags : []).map((tag) => cleanText(tag, 80)).filter(Boolean))].slice(0, 50),
  };
}

export function normalizeWorkspace(input, now = Date.now()) {
  const workspace = createWorkspace(input, Number.isFinite(input?.createdAt) ? input.createdAt : now, input?.id || crypto.randomUUID());
  workspace.updatedAt = Number.isFinite(input?.updatedAt) ? input.updatedAt : now;
  workspace.items = (Array.isArray(input?.items) ? input.items : []).slice(0, 500).map((item) => normalizeWorkspaceItem(item, now));
  if (new TextEncoder().encode(JSON.stringify(workspace)).byteLength > WORKSPACE_MAX_BYTES) throw new TypeError("Workspace exceeds 20 MiB");
  return workspace;
}

export function addWorkspaceItem(workspace, item, now = Date.now()) {
  const normalized = normalizeWorkspace(workspace, now);
  const addition = normalizeWorkspaceItem(item, now);
  const duplicate = normalized.items.findIndex((entry) => entry.type === addition.type && entry.value === addition.value);
  if (duplicate >= 0) normalized.items[duplicate] = { ...normalized.items[duplicate], ...addition, createdAt: normalized.items[duplicate].createdAt };
  else normalized.items.push(addition);
  normalized.items = normalized.items.slice(-500);
  normalized.updatedAt = now;
  return normalizeWorkspace(normalized, now);
}

export function workspaceToJson(workspace) {
  return `${JSON.stringify(normalizeWorkspace(workspace), null, 2)}\n`;
}

function markdownEscape(value) { return String(value ?? "").replace(/([\\`*_[\]<>])/g, "\\$1"); }

export function workspaceToMarkdown(workspace) {
  const item = normalizeWorkspace(workspace);
  const lines = [
    `# ${markdownEscape(item.title)}`,
    "",
    `- Updated: ${new Date(item.updatedAt).toISOString()}`,
    `- SIEM: ${markdownEscape(item.siemOrigin ?? "not specified")}`,
  ];
  if (item.sourceIncidentId) lines.push(`- Incident: ${markdownEscape(item.sourceIncidentId)}`);
  if (item.tags.length) lines.push(`- Tags: ${item.tags.map(markdownEscape).join(", ")}`);
  lines.push("", "## Objects", "");
  if (!item.items.length) lines.push("No pinned objects.");
  for (const pinned of item.items) {
    lines.push(`### ${markdownEscape(pinned.type)} — ${markdownEscape(pinned.label)}`, "", `Value: \`${markdownEscape(pinned.value)}\``);
    if (pinned.sourceEventUuid) lines.push(`Source event: \`${markdownEscape(pinned.sourceEventUuid)}\``);
    lines.push("", "```json", JSON.stringify(pinned.snapshot, null, 2), "```", "");
  }
  lines.push("## Analyst notes", "", item.notes || "No notes.", "");
  return lines.join("\n");
}
