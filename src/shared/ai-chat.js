import { normalizeWorkspaceItem } from "./workspace.js";

export const AI_CHAT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_MESSAGES = 80;
const MAX_ATTACHMENTS = 8;
const MAX_TEXT = 100_000;

function text(value, maximum = MAX_TEXT) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").slice(0, maximum);
}

function normalizeToolCall(input) {
  const id = text(input?.id, 200);
  const name = text(input?.name, 80);
  if (!id || !name) return null;
  return { id, name, arguments: input?.arguments && typeof input.arguments === "object" ? input.arguments : {} };
}

export function normalizeAiAttachment(input) {
  return normalizeWorkspaceItem(input);
}

function normalizeAiAttachments(input) {
  return (Array.isArray(input) ? input : []).slice(0, MAX_ATTACHMENTS).flatMap((attachment) => {
    try { return [normalizeAiAttachment(attachment)]; }
    catch { return []; }
  });
}

export function normalizeAiMessage(input, now = Date.now()) {
  const role = input?.role === "assistant" ? "assistant" : input?.role === "user" ? "user" : null;
  if (!role) return null;
  const content = text(input.content);
  const attachments = role === "user"
    ? normalizeAiAttachments(input.attachments)
    : [];
  const toolCalls = role === "assistant"
    ? (Array.isArray(input.toolCalls) ? input.toolCalls : []).map(normalizeToolCall).filter(Boolean).slice(0, 8)
    : [];
  if (!content.trim() && !attachments.length && !toolCalls.length) return null;
  return {
    id: text(input.id, 200) || crypto.randomUUID(),
    role,
    content,
    attachments,
    toolCalls,
    createdAt: Number.isFinite(input.createdAt) ? input.createdAt : now,
  };
}

export function normalizeAiChat(input = {}, now = Date.now()) {
  if (!input || typeof input !== "object") input = {};
  const messages = (Array.isArray(input.messages) ? input.messages : [])
    .map((message) => normalizeAiMessage(message, now)).filter(Boolean).slice(-MAX_MESSAGES);
  const chat = {
    messages,
    draft: text(input.draft, 20_000),
    pendingAttachments: normalizeAiAttachments(input.pendingAttachments),
    pendingToolCalls: (Array.isArray(input.pendingToolCalls) ? input.pendingToolCalls : [])
      .map(normalizeToolCall).filter(Boolean).slice(0, 8),
    selectedFields: [...new Set((Array.isArray(input.selectedFields) ? input.selectedFields : []).map((field) => text(field, 300)).filter(Boolean))].slice(0, 500),
    allowSiemTools: input.allowSiemTools === true,
    updatedAt: Number.isFinite(input.updatedAt) ? input.updatedAt : now,
  };
  while (new TextEncoder().encode(JSON.stringify(chat)).byteLength > AI_CHAT_MAX_BYTES && chat.messages.length > 1) chat.messages.shift();
  while (new TextEncoder().encode(JSON.stringify(chat)).byteLength > AI_CHAT_MAX_BYTES) {
    const message = chat.messages.find((entry) => entry.attachments.length);
    if (!message) break;
    message.attachments.shift();
  }
  while (new TextEncoder().encode(JSON.stringify(chat)).byteLength > AI_CHAT_MAX_BYTES && chat.pendingAttachments.length) chat.pendingAttachments.pop();
  if (new TextEncoder().encode(JSON.stringify(chat)).byteLength > AI_CHAT_MAX_BYTES) throw new TypeError("AI chat exceeds 2 MiB");
  return chat;
}

export function addAiAttachment(chat, attachment) {
  const next = normalizeAiChat(chat);
  const item = normalizeAiAttachment(attachment);
  const duplicate = next.pendingAttachments.findIndex((entry) => entry.type === item.type && entry.value === item.value);
  if (duplicate >= 0) next.pendingAttachments[duplicate] = item;
  else next.pendingAttachments.push(item);
  next.pendingAttachments = next.pendingAttachments.slice(-MAX_ATTACHMENTS);
  next.updatedAt = Date.now();
  return normalizeAiChat(next);
}

export function appendAiMessage(chat, message) {
  const next = normalizeAiChat(chat);
  const normalized = normalizeAiMessage(message);
  if (normalized && !next.messages.some((entry) => entry.id === normalized.id)) next.messages.push(normalized);
  next.messages = next.messages.slice(-MAX_MESSAGES);
  next.updatedAt = Date.now();
  return normalizeAiChat(next);
}

export function mergeAiChats(target, source) {
  let merged = normalizeAiChat(target);
  for (const message of normalizeAiChat(source).messages) merged = appendAiMessage(merged, message);
  return merged;
}

export function eventAiAttachment(event = {}) {
  const value = String(event.uuid ?? event.id ?? ([event.time, event["event_src.host"], event.correlation_name].filter(Boolean).join(":") || "current-event"));
  const label = [event.correlation_name, event["event_src.host"], event.time].filter(Boolean).join(" · ") || value;
  return normalizeAiAttachment({ type: "event", value, label, sourceEventUuid: event.uuid ?? null, snapshot: event });
}
