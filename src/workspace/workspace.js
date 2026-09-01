import { eventDiffToMarkdown, compareEvents } from "../shared/event-compare.js";
import { setSafeText } from "../shared/dom.js";
import { sanitizeFilenamePart } from "../shared/url.js";
import { workspaceToJson, workspaceToMarkdown } from "../shared/workspace.js";
import { buildEqualityPredicate } from "../shared/pdql/builder.js";
import { buildEventSearchUrl } from "../siem/features/related-events.js";
import { addAiAttachment, appendAiMessage, normalizeAiChat } from "../shared/ai-chat.js";
import { renderMarkdown } from "../shared/markdown.js";
import { downloadText } from "../shared/download.js";

const byId = (id) => document.getElementById(id);
const state = {
  workspaces: [], selectedId: null, compareIndexes: new Set(), compare: null,
  aiIndexes: new Set(), aiChat: normalizeAiChat(), aiPreviewHash: null, settings: null,
};
let aiSaveTimer;

function setStatus(message, error = false) {
  byId("workspace-status").textContent = message;
  byId("workspace-status").classList.toggle("error", error);
}

async function request(message) {
  const response = await browser.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? "Workspace operation failed");
  return response;
}

function selectedWorkspace() { return state.workspaces.find((workspace) => workspace.id === state.selectedId) ?? null; }

function filteredWorkspaces() {
  const search = byId("workspace-search").value.trim().toLowerCase();
  const sort = byId("workspace-sort").value;
  return state.workspaces.filter((workspace) => !search || `${workspace.title} ${workspace.tags.join(" ")} ${workspace.notes}`.toLowerCase().includes(search))
    .sort(sort === "title" ? (first, second) => first.title.localeCompare(second.title, "ru")
      : sort === "created" ? (first, second) => second.createdAt - first.createdAt
        : (first, second) => second.updatedAt - first.updatedAt);
}

function renderList() {
  const list = byId("workspace-list");
  list.replaceChildren();
  for (const workspace of filteredWorkspaces()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = workspace.id === state.selectedId ? "active" : "";
    const title = document.createElement("strong"); title.textContent = workspace.title;
    const metadata = document.createElement("span"); metadata.textContent = `${workspace.items.length} объектов · ${new Date(workspace.updatedAt).toLocaleString("ru-RU")}`;
    button.append(title, metadata);
    button.addEventListener("click", () => selectWorkspace(workspace.id).catch((error) => setStatus(error.message, true)));
    list.append(button);
  }
  if (!list.children.length) list.textContent = "Расследования не найдены.";
}

function snapshotDetails(item) {
  const details = document.createElement("details");
  const summary = document.createElement("summary"); summary.textContent = "Локальный snapshot";
  const pre = document.createElement("pre"); pre.textContent = JSON.stringify(item.snapshot, null, 2);
  details.append(summary, pre);
  return details;
}

function eventUrl(workspace, item) {
  const uuid = item.sourceEventUuid ?? item.snapshot?.uuid;
  if (!uuid || !workspace.siemOrigin) return null;
  return buildEventSearchUrl(workspace.siemOrigin, buildEqualityPredicate("uuid", uuid), item.snapshot?.time, "15m");
}

function renderItems(workspace) {
  const list = byId("workspace-items");
  list.replaceChildren();
  workspace.items.forEach((item, index) => {
    const article = document.createElement("article");
    const heading = document.createElement("div"); heading.className = "item-heading";
    const title = document.createElement("h3"); title.textContent = `${item.type}: ${item.label}`;
    const actions = document.createElement("div"); actions.className = "item-actions";
    if (item.type === "event") {
      const label = document.createElement("label"); label.className = "compare-choice";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = state.compareIndexes.has(index);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && state.compareIndexes.size >= 3) { checkbox.checked = false; setStatus("Для сравнения можно выбрать не более трёх событий", true); return; }
        if (checkbox.checked) state.compareIndexes.add(index); else state.compareIndexes.delete(index);
        renderCompare(workspace);
      });
      label.append(checkbox, document.createTextNode(" сравнить")); actions.append(label);
    }
    const aiLabel = document.createElement("label"); aiLabel.className = "compare-choice";
    const aiCheckbox = document.createElement("input"); aiCheckbox.type = "checkbox"; aiCheckbox.checked = state.aiIndexes.has(index);
    aiCheckbox.addEventListener("change", () => { if (aiCheckbox.checked) state.aiIndexes.add(index); else state.aiIndexes.delete(index); });
    aiLabel.append(aiCheckbox, document.createTextNode(" в AI")); actions.append(aiLabel);
    const url = eventUrl(workspace, item);
    if (url) {
      const open = document.createElement("button"); open.type = "button"; open.textContent = "Открыть событие";
      open.addEventListener("click", () => browser.runtime.sendMessage({ type: "tabs:open", url })); actions.append(open);
    }
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.textContent = "Удалить";
    remove.addEventListener("click", () => removeItem(index).catch((error) => setStatus(error.message, true))); actions.append(remove);
    heading.append(title, actions);
    const value = document.createElement("p"); value.textContent = item.value;
    article.append(heading, value, snapshotDetails(item));
    list.append(article);
  });
  if (!workspace.items.length) list.textContent = "Пока нет прикреплённых объектов. Используйте popup или правый клик по узлу графа.";
}

function renderCompare(workspace) {
  const panel = byId("compare-panel");
  const indexes = [...state.compareIndexes].sort((a, b) => a - b);
  panel.hidden = indexes.length < 2;
  if (indexes.length < 2) { state.compare = null; return; }
  const items = indexes.map((index) => workspace.items[index]);
  state.compare = compareEvents(items.map((item) => item.snapshot));
  byId("compare-event-3").hidden = state.compare.eventCount < 3;
  const tbody = byId("compare-body"); tbody.replaceChildren();
  for (const row of state.compare.rows) {
    const tr = document.createElement("tr");
    for (const value of [row.group, row.field, row.status, ...row.values.map((item) => item === undefined ? "—" : typeof item === "object" ? JSON.stringify(item) : String(item))]) {
      const td = document.createElement("td"); td.textContent = value; tr.append(td);
    }
    tbody.append(tr);
  }
  byId("compare-summary").textContent = `${state.compare.rows.filter((row) => row.status === "same").length} одинаковых · ${state.compare.rows.filter((row) => row.status === "changed").length} изменённых · ${state.compare.rows.filter((row) => row.status === "only").length} присутствуют не во всех событиях`;
}

function invalidateAiPreview() {
  state.aiPreviewHash = null;
  byId("workspace-ai-run").disabled = true;
  byId("workspace-ai-preview-output").textContent = "";
  byId("workspace-ai-preview-meta").textContent = "";
}

async function loadWorkspaceChat() {
  if (!state.selectedId) { state.aiChat = normalizeAiChat(); return; }
  const response = await request({ type: "workspace:chat:get", id: state.selectedId });
  state.aiChat = normalizeAiChat(response.chat);
}

async function saveWorkspaceChat(workspaceId = state.selectedId, chat = state.aiChat) {
  if (!workspaceId) return;
  clearTimeout(aiSaveTimer);
  await request({ type: "workspace:chat:save", id: workspaceId, chat });
}

function scheduleWorkspaceChatSave() {
  clearTimeout(aiSaveTimer);
  const workspaceId = state.selectedId;
  const chat = normalizeAiChat(state.aiChat);
  aiSaveTimer = setTimeout(() => saveWorkspaceChat(workspaceId, chat).catch((error) => setStatus(error.message, true)), 300);
}

function workspaceConversationWithDraft() {
  const content = state.aiChat.draft.trim() || "Используй приложенные данные для продолжения расследования.";
  return [...state.aiChat.messages, { role: "user", content, attachments: state.aiChat.pendingAttachments }];
}

function workspaceToolDescription(call) {
  if (call.name !== "get_workspace_objects") return call.name;
  const types = Array.isArray(call.arguments.types) ? call.arguments.types.join(", ") : "все типы";
  return `объекты расследования: ${types}, максимум ${Math.max(1, Math.min(8, Number(call.arguments.maxItems) || 8))}`;
}

function renderWorkspaceToolRequests() {
  const panel = byId("workspace-ai-tool-requests"); panel.replaceChildren();
  panel.hidden = !state.aiChat.pendingToolCalls.length;
  if (!state.aiChat.pendingToolCalls.length) return;
  const title = document.createElement("strong"); title.textContent = "AI запрашивает дополнительный локальный контекст:"; panel.append(title);
  const list = document.createElement("ul");
  for (const call of state.aiChat.pendingToolCalls) { const item = document.createElement("li"); item.textContent = workspaceToolDescription(call); list.append(item); }
  const run = document.createElement("button"); run.type = "button"; run.textContent = "Подтвердить добавление объектов";
  run.addEventListener("click", () => executeWorkspaceToolCalls().catch((error) => setStatus(error.message, true)));
  panel.append(list, run);
}

function renderAiWorkspace() {
  const workspace = selectedWorkspace();
  const panel = byId("workspace-ai"); panel.hidden = !workspace || state.settings?.features?.aiAssistant === false;
  if (!workspace || panel.hidden) return;
  const messages = byId("workspace-ai-messages"); messages.replaceChildren();
  for (const message of state.aiChat.messages) {
    const article = document.createElement("article"); article.className = `workspace-ai-message ${message.role}`;
    const title = document.createElement("strong"); title.textContent = message.role === "user" ? "Аналитик" : "SEC AI Assistant";
    const content = document.createElement("div"); content.className = "markdown-body";
    renderMarkdown(content, message.content); article.append(title, content);
    if (message.attachments.length) {
      const context = document.createElement("div"); context.className = "workspace-ai-attachments";
      for (const attachment of message.attachments) { const chip = document.createElement("span"); chip.textContent = `${attachment.type}: ${attachment.label}`; context.append(chip); }
      article.append(context);
    }
    messages.append(article);
  }
  if (!messages.children.length) messages.textContent = "Постоянный диалог этого расследования пока пуст.";
  const pending = byId("workspace-ai-context"); pending.replaceChildren();
  state.aiChat.pendingAttachments.forEach((attachment, index) => {
    const chip = document.createElement("span"); chip.textContent = `${attachment.type}: ${attachment.label}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×";
    remove.addEventListener("click", () => { state.aiChat.pendingAttachments.splice(index, 1); invalidateAiPreview(); renderAiWorkspace(); scheduleWorkspaceChatSave(); });
    chip.append(remove); pending.append(chip);
  });
  byId("workspace-ai-message").value = state.aiChat.draft;
  byId("workspace-ai-tools").checked = state.aiChat.allowSiemTools;
  byId("workspace-ai-preview").disabled = !state.settings?.ai?.endpoint || !state.settings?.ai?.model;
  renderWorkspaceToolRequests();
}

function addSelectedWorkspaceItems() {
  const workspace = selectedWorkspace();
  for (const index of state.aiIndexes) {
    const item = workspace.items[index];
    if (item) state.aiChat = addAiAttachment(state.aiChat, item);
  }
  state.aiIndexes.clear(); invalidateAiPreview(); render(); scheduleWorkspaceChatSave();
}

function addWorkspaceNotes() {
  const workspace = selectedWorkspace();
  if (!workspace.notes.trim()) throw new Error("В расследовании нет заметок аналитика");
  state.aiChat = addAiAttachment(state.aiChat, { type: "note", value: `notes:${workspace.id}`, label: "Заметки аналитика", snapshot: { notes: workspace.notes } });
  invalidateAiPreview(); renderAiWorkspace(); scheduleWorkspaceChatSave();
}

async function executeWorkspaceToolCalls() {
  const workspace = selectedWorkspace();
  const calls = [...state.aiChat.pendingToolCalls];
  if (!calls.length || !confirm(`Добавить в следующее сообщение данные для ${calls.length} показанных запросов AI?`)) return;
  for (const call of calls) {
    if (call.name !== "get_workspace_objects") throw new Error("AI запросил неподдерживаемый инструмент");
    const allowed = new Set(["event", "process", "ioc", "host", "account", "incident", "note"]);
    const types = new Set((Array.isArray(call.arguments.types) ? call.arguments.types : []).filter((type) => allowed.has(type)));
    const limit = Math.max(1, Math.min(8, Number(call.arguments.maxItems) || 8));
    const items = workspace.items.filter((item) => !types.size || types.has(item.type)).slice(0, limit);
    for (const item of items) state.aiChat = addAiAttachment(state.aiChat, item);
  }
  state.aiChat.pendingToolCalls = [];
  state.aiChat.draft = "Используй подтверждённые объекты Investigation Workspace для продолжения анализа.";
  invalidateAiPreview(); renderAiWorkspace(); await saveWorkspaceChat();
}

async function previewWorkspaceAi() {
  byId("workspace-ai-preview-meta").textContent = "Формирую payload локально…";
  const response = await request({
    type: "ai:preview", conversation: workspaceConversationWithDraft(), contextType: "workspace",
    selectedFields: state.settings.ai.selectedFields, allowSiemTools: state.aiChat.allowSiemTools,
  });
  state.aiPreviewHash = response.preview.hash;
  byId("workspace-ai-preview-output").textContent = response.preview.serialized;
  const warnings = response.preview.warnings.length ? `\nПредупреждения:\n- ${response.preview.warnings.join("\n- ")}` : "";
  byId("workspace-ai-preview-meta").textContent = `${response.preview.byteLength} UTF-8 bytes · destination ${response.endpoint}${warnings}`;
  byId("workspace-ai-run").disabled = false;
}

async function runWorkspaceAi() {
  if (!state.aiPreviewHash) return;
  if (!confirm(`Отправить в ${state.settings.ai.endpoint} ровно показанный payload?`)) return;
  const outbound = workspaceConversationWithDraft();
  const response = await request({
    type: "enrichment:llm", conversation: outbound, contextType: "workspace",
    selectedFields: state.settings.ai.selectedFields, allowSiemTools: state.aiChat.allowSiemTools,
    previewHash: state.aiPreviewHash, confirmed: true,
  });
  state.aiChat = appendAiMessage(state.aiChat, outbound.at(-1));
  const toolCalls = response.result.toolCalls ?? [];
  state.aiChat = appendAiMessage(state.aiChat, {
    role: "assistant",
    content: response.result.content || `Запрошены дополнительные данные: ${toolCalls.map(workspaceToolDescription).join("; ")}`,
    toolCalls,
  });
  state.aiChat.draft = "";
  state.aiChat.pendingAttachments = [];
  state.aiChat.pendingToolCalls = toolCalls;
  invalidateAiPreview(); renderAiWorkspace(); await saveWorkspaceChat();
}

function renderEditor() {
  const workspace = selectedWorkspace();
  byId("workspace-empty").hidden = Boolean(workspace);
  byId("workspace-editor").hidden = !workspace;
  if (!workspace) return;
  byId("workspace-title").value = workspace.title;
  byId("workspace-origin").textContent = workspace.siemOrigin ?? "SIEM origin не указан";
  byId("workspace-tags").value = workspace.tags.join(", ");
  byId("workspace-notes").value = workspace.notes;
  renderItems(workspace);
  renderCompare(workspace);
  renderAiWorkspace();
}

function render() { renderList(); renderEditor(); }

async function refresh({ selectId = state.selectedId } = {}) {
  const response = await request({ type: "workspace:list" });
  state.workspaces = response.workspaces;
  state.selectedId = state.workspaces.some((workspace) => workspace.id === selectId) ? selectId : state.workspaces[0]?.id ?? null;
  await loadWorkspaceChat();
  render();
}

async function selectWorkspace(id) {
  if (state.selectedId && state.selectedId !== id) await saveWorkspaceChat();
  state.selectedId = id;
  state.compareIndexes.clear();
  state.aiIndexes.clear();
  state.aiPreviewHash = null;
  await loadWorkspaceChat();
  render();
}

async function createNew() {
  await saveWorkspaceChat();
  const response = await request({ type: "workspace:create", workspace: { title: "Новое расследование" } });
  state.compareIndexes.clear();
  state.aiIndexes.clear();
  await refresh({ selectId: response.workspace.id });
  byId("workspace-title").focus();
}

async function saveCurrent() {
  const workspace = selectedWorkspace();
  if (!workspace) return;
  await saveWorkspaceChat();
  const response = await request({
    type: "workspace:update",
    id: workspace.id,
    patch: {
      title: byId("workspace-title").value,
      tags: byId("workspace-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
      notes: byId("workspace-notes").value,
    },
  });
  await refresh({ selectId: response.workspace.id });
  setStatus("Расследование сохранено локально");
}

async function deleteCurrent() {
  const workspace = selectedWorkspace();
  if (!workspace || !confirm(`Удалить расследование «${workspace.title}»? Это действие нельзя отменить.`)) return;
  clearTimeout(aiSaveTimer);
  await request({ type: "workspace:delete", id: workspace.id });
  state.compareIndexes.clear();
  state.aiIndexes.clear();
  await refresh({ selectId: null });
  setStatus("Расследование удалено");
}

async function removeItem(index) {
  const workspace = selectedWorkspace();
  await saveWorkspaceChat();
  await request({ type: "workspace:item:remove", id: workspace.id, index });
  state.compareIndexes.clear();
  state.aiIndexes.clear();
  await refresh({ selectId: workspace.id });
}

async function download(text, extension, mime) {
  const workspace = selectedWorkspace();
  await downloadText(text, { filename: `apepatrol-${sanitizeFilenamePart(workspace.title) || workspace.id}.${extension}`, mime });
}

function compareLabels(workspace) { return [...state.compareIndexes].sort((a, b) => a - b).map((index) => workspace.items[index].label); }

byId("workspace-new").addEventListener("click", () => createNew().catch((error) => setStatus(error.message, true)));
byId("workspace-save").addEventListener("click", () => saveCurrent().catch((error) => setStatus(error.message, true)));
byId("workspace-delete").addEventListener("click", () => deleteCurrent().catch((error) => setStatus(error.message, true)));
byId("workspace-search").addEventListener("input", renderList);
byId("workspace-sort").addEventListener("change", renderList);
byId("export-json").addEventListener("click", () => download(workspaceToJson(selectedWorkspace()), "json", "application/json").catch((error) => setStatus(error.message, true)));
byId("export-markdown").addEventListener("click", () => download(workspaceToMarkdown(selectedWorkspace()), "md", "text/markdown").catch((error) => setStatus(error.message, true)));
byId("copy-compare-json").addEventListener("click", () => navigator.clipboard.writeText(JSON.stringify(state.compare, null, 2)).catch((error) => setStatus(error.message, true)));
byId("copy-compare-markdown").addEventListener("click", () => navigator.clipboard.writeText(eventDiffToMarkdown(state.compare, compareLabels(selectedWorkspace()))).catch((error) => setStatus(error.message, true)));
byId("workspace-ai-add-selected").addEventListener("click", () => {
  try { addSelectedWorkspaceItems(); } catch (error) { setStatus(error.message, true); }
});
byId("workspace-ai-add-notes").addEventListener("click", () => {
  try { addWorkspaceNotes(); } catch (error) { setStatus(error.message, true); }
});
byId("workspace-ai-message").addEventListener("input", (event) => {
  state.aiChat.draft = event.target.value; state.aiChat.updatedAt = Date.now(); invalidateAiPreview(); scheduleWorkspaceChatSave();
});
byId("workspace-ai-tools").addEventListener("change", (event) => {
  state.aiChat.allowSiemTools = event.target.checked; state.aiChat.updatedAt = Date.now(); invalidateAiPreview(); scheduleWorkspaceChatSave();
});
byId("workspace-ai-clear").addEventListener("click", () => {
  if (!confirm("Очистить постоянный AI-диалог этого расследования?")) return;
  state.aiChat = normalizeAiChat({ allowSiemTools: state.aiChat.allowSiemTools });
  invalidateAiPreview(); renderAiWorkspace(); saveWorkspaceChat().catch((error) => setStatus(error.message, true));
});
byId("workspace-ai-preview").addEventListener("click", () => previewWorkspaceAi().catch((error) => setStatus(error.message, true)));
byId("workspace-ai-run").addEventListener("click", () => runWorkspaceAi().catch((error) => setStatus(error.message, true)));

async function initialize() {
  const settingsResponse = await request({ type: "settings:get" });
  state.settings = settingsResponse.settings;
  const requestedId = new URLSearchParams(location.search).get("id");
  await refresh({ selectId: requestedId });
}

initialize().catch((error) => {
  setSafeText(byId("workspace-empty"), error.message);
  setStatus(error.message, true);
});
