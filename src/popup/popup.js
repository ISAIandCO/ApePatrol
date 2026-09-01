import { setSafeText } from "../shared/dom.js";
import { buildEqualityPredicate } from "../shared/pdql/builder.js";
import { sanitizeFilenamePart } from "../shared/url.js";
import { buildEventSearchUrl } from "../siem/features/related-events.js";
import { renderFilterTemplate } from "../siem/features/custom-filters.js";
import { loadOptionalPopupFeatures } from "./feature-loader.js";
import { normalizeSettings, SYNC_STORAGE_KEY } from "../shared/settings.js";
import { buildIocBatchJobs, collectEventIocs, IOC_BATCH_PROVIDERS } from "../shared/ioc-batch.js";
import { addAiAttachment, appendAiMessage, eventAiAttachment, normalizeAiChat } from "../shared/ai-chat.js";
import { renderMarkdown } from "../shared/markdown.js";
import { downloadText } from "../shared/download.js";

const state = {
  tab: null,
  context: null,
  settings: null,
  related: [],
  lists: [],
  knowledgeBaseUrl: null,
  rule: null,
  incident: null,
  aiPreviewHash: null,
  iocs: [],
  batchJobs: [],
  batchRequestId: null,
  aiChat: normalizeAiChat(),
  workspaces: [],
};
const byId = (id) => document.getElementById(id);
const setStatus = (message) => { byId("status").textContent = message; };
const showError = (target, error) => { setSafeText(target, error?.message ?? String(error)); };

async function sendToContent(message) {
  if (!state.tab?.id) throw new Error("No active tab");
  try {
    const response = await browser.tabs.sendMessage(state.tab.id, message);
    if (!response?.ok) {
      const responseError = new Error(response?.error ?? "Feature unavailable on this page");
      responseError.code = response?.errorCode;
      throw responseError;
    }
    return response;
  } catch (error) {
    throw new Error(error.message.includes("Receiving end") ? "Open a configured MaxPatrol SIEM event page" : error.message);
  }
}

function switchPanel(id) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.panel === id));
  saveTabSession();
}

function activePanel() { return document.querySelector(".panel.active")?.id ?? "event"; }
function saveTabSession() {
  if (!state.tab?.id) return;
  browser.runtime.sendMessage({ type: "tab-session:save", tabId: state.tab.id, session: { activePanel: activePanel(), aiChat: normalizeAiChat(state.aiChat) } }).catch(console.error);
}

async function loadTabSession() {
  if (!state.tab?.id) return "event";
  const response = await browser.runtime.sendMessage({ type: "tab-session:get", tabId: state.tab.id });
  if (!response?.ok) throw new Error(response?.error ?? "Не удалось восстановить диалог вкладки");
  state.aiChat = normalizeAiChat(response.session?.aiChat);
  return response.session?.activePanel ?? "event";
}

function setPanelAvailability(id, available) {
  const panel = byId(id);
  const button = document.querySelector(`nav button[data-panel='${id}']`);
  if (panel) panel.hidden = !available;
  if (button) button.hidden = !available;
  if (!available && panel?.classList.contains("active")) switchPanel("event");
}

function applyFeatureVisibility() {
  const features = state.settings.features;
  setPanelAvailability("process", features.processTree);
  setPanelAvailability("related", features.relatedEvents);
  setPanelAvailability("incidents", features.incidentContext);
  setPanelAvailability("ai", features.aiAssistant);
  byId("table-list-tools").hidden = !features.tableListTools;
  byId("workspace-actions").hidden = !features.investigationWorkspace;
  byId("batch-ioc").hidden = !features.batchIoc;
  byId("rule-intelligence").hidden = !features.ruleIntelligence || !state.rule;
}

function selectedAiFields() {
  return [...document.querySelectorAll("#ai-fields input:checked")].map((input) => input.value);
}

function invalidateAiPreview() {
  state.aiPreviewHash = null;
  byId("ai-run").disabled = true;
  byId("ai-preview").textContent = "";
  byId("ai-preview-meta").textContent = "";
}

function renderAiFieldPicker() {
  const picker = byId("ai-field-picker");
  const fields = byId("ai-fields");
  fields.replaceChildren();
  const selectedMode = state.settings.ai.mode === "selected";
  picker.hidden = !selectedMode;
  if (!selectedMode) return;
  const defaults = new Set(state.aiChat.selectedFields.length ? state.aiChat.selectedFields : state.settings.ai.selectedFields);
  for (const field of Object.keys(state.context?.event ?? {}).sort()) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = field;
    checkbox.checked = defaults.has(field);
    checkbox.addEventListener("change", () => {
      state.aiChat.selectedFields = selectedAiFields();
      state.aiChat.updatedAt = Date.now();
      invalidateAiPreview();
      saveTabSession();
    });
    label.append(checkbox, document.createTextNode(` ${field}`));
    fields.append(label);
  }
}

function conversationWithDraft() {
  let attachments = state.aiChat.pendingAttachments;
  if (!state.aiChat.messages.length && !attachments.length) attachments = [eventAiAttachment(state.context?.event)];
  const content = state.aiChat.draft.trim() || (state.aiChat.messages.length
    ? "Используй приложенные данные для продолжения расследования."
    : "Проанализируй приложенное событие безопасности.");
  return [...state.aiChat.messages, { role: "user", content, attachments }];
}

function renderAiChat() {
  const messages = byId("ai-chat-messages");
  messages.replaceChildren();
  for (const message of state.aiChat.messages) {
    const article = document.createElement("article");
    article.className = `ai-message ${message.role}`;
    const heading = document.createElement("strong");
    heading.textContent = message.role === "user" ? "Аналитик" : "SEC AI Assistant";
    const content = document.createElement("div"); content.className = "markdown-body";
    renderMarkdown(content, message.content);
    article.append(heading, content);
    if (message.attachments.length) {
      const context = document.createElement("div"); context.className = "ai-attachments";
      for (const item of message.attachments) {
        const chip = document.createElement("span"); chip.textContent = `${item.type}: ${item.label}`; context.append(chip);
      }
      article.append(context);
    }
    messages.append(article);
  }
  if (!messages.children.length) messages.textContent = "Диалог для этой вкладки пока пуст.";
  const pending = byId("ai-pending-context"); pending.replaceChildren();
  for (const [index, item] of state.aiChat.pendingAttachments.entries()) {
    const chip = document.createElement("span"); chip.textContent = `${item.type}: ${item.label}`;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = "Убрать из следующего сообщения";
    remove.addEventListener("click", () => {
      state.aiChat.pendingAttachments.splice(index, 1); invalidateAiPreview(); renderAiChat(); saveTabSession();
    });
    chip.append(remove); pending.append(chip);
  }
  byId("ai-message").value = state.aiChat.draft;
  byId("ai-allow-tools").checked = state.aiChat.allowSiemTools;
  renderAiToolRequests();
}

function describeToolCall(call) {
  const names = {
    get_related_events: "связанные события",
    get_process_context: "контекст процессов",
    get_asset_context: "контекст актива/EDR",
    get_rule_context: "метаданные правила корреляции",
  };
  return `${names[call.name] ?? call.name}${Object.keys(call.arguments).length ? ` · ${JSON.stringify(call.arguments)}` : ""}`;
}

function renderAiToolRequests() {
  const panel = byId("ai-tool-requests"); panel.replaceChildren();
  panel.hidden = !state.aiChat.pendingToolCalls.length;
  if (!state.aiChat.pendingToolCalls.length) return;
  const title = document.createElement("strong"); title.textContent = "AI запрашивает данные SIEM:"; panel.append(title);
  const list = document.createElement("ul");
  for (const call of state.aiChat.pendingToolCalls) { const item = document.createElement("li"); item.textContent = describeToolCall(call); list.append(item); }
  const run = document.createElement("button"); run.type = "button"; run.textContent = "Подтвердить read-only запросы";
  run.addEventListener("click", () => executeAiToolCalls().catch((error) => showError(panel, error)));
  panel.append(list, run);
}

function boundedProcessResult(response) {
  const graph = response.graph ?? {};
  const eventFields = [
    "uuid", "time", "event_src.host", "correlation_name", "subject.account.name",
    "object.process.id", "object.process.parent.id", "object.process.guid", "object.process.parent.guid",
    "object.process.name", "object.process.path", "object.process.cmdline",
    "subject.process.id", "subject.process.parent.id", "subject.process.guid", "subject.process.parent.guid",
    "subject.process.name", "subject.process.path", "subject.process.cmdline",
  ];
  return {
    sourceUuid: response.sourceUuid ?? null,
    nodeCount: graph.nodes?.length ?? 0,
    edgeCount: graph.edges?.length ?? 0,
    queryMetadata: response.queryMetadata,
    nodes: (graph.nodes ?? []).slice(0, 20).map((node) => ({
      id: node.id,
      parentId: node.parentId,
      connectionCount: node.connectionCount,
      event: Object.fromEntries(eventFields.filter((field) => node.event?.[field] !== undefined).map((field) => [field, node.event[field]])),
    })),
    truncatedForAi: (graph.nodes?.length ?? 0) > 20,
  };
}

async function executeTabAiTool(call) {
  switch (call.name) {
    case "get_related_events": {
      const relation = ["host", "account", "ip", "process"].includes(call.arguments.relation) ? call.arguments.relation : null;
      if (!relation) throw new Error("AI указал недопустимый тип связи");
      const response = await sendToContent({ type: "siem:ai-related", arguments: {
        relation,
        range: ["5m", "15m", "1h", "24h"].includes(call.arguments.range) ? call.arguments.range : "15m",
        limit: Math.max(1, Math.min(25, Number(call.arguments.limit) || 25)),
      } });
      return { type: "note", value: call.id, label: `${response.label} · ${response.range}`, snapshot: response };
    }
    case "get_process_context": {
      const response = await sendToContent({ type: "siem:process" });
      return { type: "process", value: call.id, label: "Граф процессов текущего события", snapshot: boundedProcessResult(response) };
    }
    case "get_asset_context": {
      const response = await sendToContent({ type: "siem:asset" });
      return { type: "host", value: call.id, label: "Контекст актива текущего события", snapshot: response.asset };
    }
    case "get_rule_context": {
      const response = await sendToContent({ type: "siem:rule-context" });
      return { type: "note", value: call.id, label: "Правило корреляции текущего события", snapshot: response.rule ?? {} };
    }
    default:
      throw new Error("AI запросил неподдерживаемый инструмент");
  }
}

async function executeAiToolCalls() {
  const calls = [...state.aiChat.pendingToolCalls];
  if (!calls.length || !confirm(`Выполнить ${calls.length} показанных read-only запросов к текущей SIEM?`)) return;
  for (const call of calls) state.aiChat = addAiAttachment(state.aiChat, await executeTabAiTool(call));
  state.aiChat.pendingToolCalls = [];
  state.aiChat.draft = "Используй подтверждённые результаты запросов к SIEM для продолжения анализа.";
  state.aiChat.updatedAt = Date.now();
  invalidateAiPreview(); renderAiChat(); saveTabSession();
}

async function loadAiWorkspaceChoices() {
  const response = await browser.runtime.sendMessage({ type: "workspace:list" });
  state.workspaces = response?.ok ? response.workspaces.filter((workspace) => !state.context?.origin || workspace.siemOrigin === state.context.origin) : [];
  const select = byId("ai-workspace-choice"); select.replaceChildren();
  for (const workspace of state.workspaces) {
    const option = document.createElement("option"); option.value = workspace.id; option.textContent = workspace.title; select.append(option);
  }
  const create = document.createElement("option"); create.value = ""; create.textContent = "Новое расследование"; select.append(create);
}

async function promoteAiChat() {
  let workspaceId = byId("ai-workspace-choice").value;
  if (!workspaceId) {
    const created = await browser.runtime.sendMessage({ type: "workspace:create", workspace: { title: `AI-расследование ${new Date().toLocaleString("ru-RU")}`, siemOrigin: state.context.origin } });
    if (!created?.ok) throw new Error(created?.error ?? "Не удалось создать расследование");
    workspaceId = created.workspace.id;
  }
  const imported = await browser.runtime.sendMessage({ type: "workspace:chat:import", id: workspaceId, chat: state.aiChat });
  if (!imported?.ok) throw new Error(imported?.error ?? "Не удалось перенести диалог");
  await browser.tabs.create({ url: browser.runtime.getURL(`workspace.html?id=${encodeURIComponent(workspaceId)}`) });
}

function renderEvent() {
  byId("event-json").textContent = JSON.stringify(state.context?.event ?? {}, null, 2);
  const found = Object.keys(state.context?.event ?? {}).length;
  setStatus(found
    ? `MP SIEM adapter · ${found} fields`
    : state.context?.detected
      ? "MP SIEM detected · event card is closed or still loading"
      : "Configured origin reached · MP SIEM UI not detected");
  renderIncidentContext();
  const ai = state.settings.ai;
  byId("ai-disclosure").textContent = `Destination: ${ai.endpoint || "not configured"}. Mode: ${ai.mode}. ApePatrol will show the exact final request body before transmission; warnings are not a DLP guarantee.`;
  byId("ai-preview-button").disabled = !state.settings.features.aiAssistant || !ai.endpoint || !ai.model;
  invalidateAiPreview();
  renderAiFieldPicker();
  renderCustomFilters();
  renderWorkspaceActions();
  renderBatchChoices();
}

function renderIncidentContext() {
  if (!state.settings.features.incidentContext) return;
  const event = state.context?.event ?? {};
  const incidentId = state.incident?.incidentId ?? event.incident_id;
  const correlationName = state.incident?.correlationName ?? event.correlation_name;
  const correlationType = String(state.incident?.correlationType ?? event.correlation_type ?? "").toLowerCase();
  let message;
  if (incidentId) {
    message = `Linked incident ID: ${incidentId}. Use the native SIEM incident action to open or modify it.`;
  } else if (state.incident === null && event.uuid) {
    message = "Loading incident context from SIEM…";
  } else if (correlationType === "incident") {
    message = `The selected correlation event${correlationName ? ` (${correlationName})` : ""} is registered as an incident${event.uuid ? `; event UUID: ${event.uuid}` : ""}.`;
  } else if (correlationName) {
    message = `Correlation event selected: ${correlationName}. SIEM did not return a linked incident ID${correlationType ? ` (correlation type: ${correlationType})` : ""}.`;
  } else {
    message = "No incident link is present in the current event. Related host, account and IP searches remain available in the Related tab.";
  }
  byId("incident-output").textContent = message;
}

function renderWorkspaceActions() {
  const event = state.context?.event ?? {};
  byId("pin-current-event").hidden = !event.uuid;
  byId("pin-current-host").hidden = !event["event_src.host"];
  byId("pin-current-account").hidden = !(event["subject.account.name"] ?? event["object.account.name"]);
  byId("pin-current-incident").hidden = !event.incident_id;
}

function renderRuleIntelligence() {
  const panel = byId("rule-intelligence");
  const output = byId("rule-intelligence-output");
  output.replaceChildren();
  panel.hidden = !state.rule || !state.settings.features.ruleIntelligence;
  if (!state.rule) return;
  const list = document.createElement("dl"); list.className = "rule-grid";
  const rows = [
    ["Name", state.rule.name], ["ID", state.rule.id], ["Description", state.rule.description],
    ["Severity", state.rule.severity], ["Categories", state.rule.categories?.join(", ")],
    ["MITRE ATT&CK", state.rule.mitreTechniques?.join(", ")],
    ["ATT&CK source", state.rule.mitreSource], ["References", state.rule.references?.join("\n")],
    ["Status", state.rule.metadata?.status], ["Version", state.rule.metadata?.version], ["Author", state.rule.metadata?.author],
  ];
  for (const [label, value] of rows.filter(([, value]) => value)) {
    const term = document.createElement("dt"); term.textContent = label;
    const detail = document.createElement("dd"); detail.textContent = value;
    list.append(term, detail);
  }
  output.append(list);
}

function invalidateBatchPreview() {
  state.batchJobs = [];
  byId("batch-run").disabled = true;
  byId("batch-preview-output").replaceChildren();
}

function checkedValues(selector) { return [...document.querySelectorAll(selector)].filter((input) => input.checked).map((input) => input.value); }

function renderBatchChoices() {
  if (!state.settings.features.batchIoc) return;
  state.iocs = collectEventIocs(state.context?.event);
  const iocList = byId("batch-ioc-list"); iocList.replaceChildren();
  state.iocs.forEach((ioc, index) => {
    const label = document.createElement("label");
    const input = document.createElement("input"); input.type = "checkbox"; input.value = String(index); input.checked = true;
    input.addEventListener("change", invalidateBatchPreview);
    label.append(input, document.createTextNode(` ${ioc.type}: ${ioc.value} (${ioc.fields.join(", ")})`)); iocList.append(label);
  });
  if (!state.iocs.length) iocList.textContent = "В текущем событии не найдены поддерживаемые IOC.";
  const providerList = byId("batch-provider-list"); providerList.replaceChildren();
  for (const [id, provider] of Object.entries(IOC_BATCH_PROVIDERS)) {
    const label = document.createElement("label");
    const input = document.createElement("input"); input.type = "checkbox"; input.value = id; input.checked = true;
    input.addEventListener("change", invalidateBatchPreview);
    label.append(input, document.createTextNode(` ${provider.name}`)); providerList.append(label);
  }
  invalidateBatchPreview();
}

function appendCell(row, value) { const cell = document.createElement("td"); cell.textContent = String(value ?? ""); row.append(cell); }

function previewIocBatch() {
  const iocs = checkedValues("#batch-ioc-list input").map((index) => state.iocs[Number(index)]).filter(Boolean);
  state.batchJobs = buildIocBatchJobs(iocs, IOC_BATCH_PROVIDERS, checkedValues("#batch-provider-list input"));
  if (!state.batchJobs.length) throw new Error("Выберите хотя бы один совместимый IOC/provider");
  const table = document.createElement("table");
  const head = document.createElement("tr"); for (const label of ["IOC", "Тип", "Provider", "Будет отправлен"]) { const th = document.createElement("th"); th.textContent = label; head.append(th); } table.append(head);
  for (const job of state.batchJobs) {
    const row = document.createElement("tr");
    for (const value of [job.ioc.value, job.ioc.type, IOC_BATCH_PROVIDERS[job.provider].name, "Да, после подтверждения"]) appendCell(row, value);
    table.append(row);
  }
  const output = byId("batch-preview-output"); output.replaceChildren(table);
  byId("batch-run").disabled = false;
}

function renderBatchResults(batch) {
  const container = byId("batch-results"); container.replaceChildren();
  const summary = document.createElement("p"); summary.textContent = `${batch.summary.ok}/${batch.summary.total} успешно · ${batch.summary.cached} из cache · ${batch.summary.errors} ошибок · ${batch.summary.cancelled} отменено`; container.append(summary);
  const table = document.createElement("table");
  const head = document.createElement("tr"); for (const label of ["IOC", "Provider", "Status", "Result", "Action"]) { const th = document.createElement("th"); th.textContent = label; head.append(th); } table.append(head);
  for (const result of batch.results) {
    const row = document.createElement("tr"); row.className = result.status === "ok" ? result.cached ? "batch-cached" : "batch-ok" : "batch-error";
    const iocType = result.iocType ?? result.ioc?.type;
    const iocValue = typeof result.ioc === "string" ? result.ioc : result.ioc?.value;
    appendCell(row, `${iocType}: ${iocValue}`); appendCell(row, result.providerName ?? IOC_BATCH_PROVIDERS[result.provider]?.name ?? result.provider); appendCell(row, result.cached ? "cached" : result.status); appendCell(row, result.summary ?? result.error);
    const action = document.createElement("td");
    if (result.status === "error" && result.retryable) {
      const retry = document.createElement("button"); retry.type = "button"; retry.textContent = "Retry provider";
      retry.addEventListener("click", () => runIocBatch([{ provider: result.provider, ioc: result.ioc }], { bypassCache: true }).catch((error) => showError(container, error))); action.append(retry);
    }
    row.append(action); table.append(row);
  }
  container.append(table);
}

async function runIocBatch(jobs = state.batchJobs, { bypassCache = false } = {}) {
  if (!jobs.length) throw new Error("Сначала сформируйте preview");
  if (!confirm(`Отправить ${jobs.length} IOC/provider запросов ровно по показанному preview? Cache может исключить повторную внешнюю отправку.`)) return;
  const requestId = crypto.randomUUID();
  state.batchRequestId = requestId;
  byId("batch-run").disabled = true; byId("batch-cancel").disabled = false;
  try {
    const response = await browser.runtime.sendMessage({ type: "enrichment:batch:start", requestId, jobs, bypassCache, confirmed: true });
    if (!response?.ok) throw new Error(response?.error ?? "IOC batch failed");
    renderBatchResults(response.batch);
  } finally {
    state.batchRequestId = null; byId("batch-cancel").disabled = true; byId("batch-run").disabled = !state.batchJobs.length;
  }
}

async function pinCurrent(type) {
  const event = state.context.event;
  const account = event["subject.account.name"] ?? event["object.account.name"];
  const definitions = {
    event: { value: event.uuid, label: event.correlation_name ?? event.uuid, snapshot: event },
    host: { value: event["event_src.host"], label: event["event_src.host"], snapshot: { host: event["event_src.host"] } },
    account: { value: account, label: account, snapshot: { account } },
    incident: { value: event.incident_id, label: `Incident ${event.incident_id}`, snapshot: { incidentId: event.incident_id } },
  };
  const item = definitions[type];
  if (!item?.value) throw new Error(`В событии нет объекта ${type}`);
  const response = await browser.runtime.sendMessage({
    type: "workspace:item:add", siemOrigin: state.context.origin, sourceIncidentId: event.incident_id ?? null,
    item: { type, ...item, sourceEventUuid: event.uuid ?? null },
  });
  if (!response?.ok) throw new Error(response?.error ?? "Не удалось прикрепить объект");
  byId("workspace-output").textContent = `Добавлено в «${response.workspace.title}»`;
}

function renderCustomFilters() {
  const select = byId("custom-filter");
  select.replaceChildren();
  const filters = state.settings.customFilters.filter((item) => item.enabled).map((filter) => ({ filter, rendered: renderFilterTemplate(filter.template, state.context.event) }));
  filters.sort((a, b) => Number(b.rendered.ok) - Number(a.rendered.ok) || a.filter.name.localeCompare(b.filter.name, "ru"));
  for (const { filter, rendered } of filters) {
    const option = document.createElement("option");
    option.value = filter.id;
    option.disabled = !rendered.ok;
    option.textContent = `${filter.name}${rendered.ok ? "" : ` — нет полей: ${rendered.missing.join(", ")}`}`;
    select.append(option);
  }
  previewCustomFilter();
}

function selectedFilter() { return state.settings.customFilters.find((filter) => filter.id === byId("custom-filter").value); }
function previewCustomFilter() {
  const filter = selectedFilter();
  const rendered = filter ? renderFilterTemplate(filter.template, state.context.event) : { ok: false, missing: [] };
  byId("filter-description").textContent = filter?.description ?? "Для открытого события нет доступных встроенных фильтров.";
  byId("filter-preview").textContent = rendered.ok ? rendered.query : `Unavailable. Missing fields: ${rendered.missing.join(", ") || "none"}`;
  byId("open-filter").disabled = !rendered.ok;
}

function renderRelated() {
  const output = byId("related-output");
  output.replaceChildren();
  const groups = Map.groupBy(state.related, (action) => action.group);
  for (const [group, actions] of groups) {
    const section = document.createElement("div");
    section.className = "related-group";
    const heading = document.createElement("h3");
    heading.textContent = group;
    section.append(heading);
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      button.addEventListener("click", () => browser.runtime.sendMessage({ type: "tabs:open", url: action.urls[byId("related-range").value] }));
      section.append(button);
    }
    output.append(section);
  }
  if (!state.related.length) output.textContent = "No supported investigation fields are present in this event.";
}

async function openProcessGraph(layout) {
  if (!state.tab?.id) throw new Error("No active SIEM tab");
  byId("process-output").textContent = "Получаю процессы и создаю автономный снимок…";
  const response = await sendToContent({ type: "siem:process" });
  const saved = await browser.runtime.sendMessage({
    type: "graph:snapshot:save",
    snapshot: {
      sourceTabId: state.tab.id,
      sourceEvent: state.context.event,
      response,
    },
  });
  if (!saved?.ok) throw new Error(saved?.error ?? "Не удалось сохранить снимок графа");
  const search = new URLSearchParams({ tabId: String(state.tab.id), snapshotId: saved.snapshot.id, layout });
  await browser.tabs.create({ url: browser.runtime.getURL(`process-graph.html?${search}`) });
  byId("process-output").textContent = "Граф открыт в автономной вкладке. Снимок останется доступен после закрытия исходной вкладки SIEM.";
}

async function downloadEvent() {
  const event = state.context.event;
  const timestamp = sanitizeFilenamePart(event.time);
  const uuid = sanitizeFilenamePart(event.uuid);
  const host = sanitizeFilenamePart(event["event_src.host"]);
  await downloadText(JSON.stringify(event, null, 2), { filename: `siem-event-${timestamp}-${uuid}-${host}.json`, mime: "application/json" });
}

async function eventLink() {
  const event = state.context.event;
  if (!event.uuid) throw new Error("Current event has no UUID");
  return buildEventSearchUrl(state.context.origin, buildEqualityPredicate("uuid", event.uuid), event.time, "5m");
}

async function loadLists() {
  const result = await sendToContent({ type: "siem:table-lists" });
  state.lists = Array.isArray(result.lists) ? result.lists : result.lists?.items ?? result.lists?.lists ?? [];
  const select = byId("table-list");
  select.replaceChildren();
  for (const list of state.lists) {
    const option = document.createElement("option");
    option.value = String(state.lists.indexOf(list));
    option.textContent = list.name ?? list.displayName ?? list.title ?? list.id ?? "Unnamed list";
    select.append(option);
  }
  byId("tools-output").textContent = `${state.lists.length} list(s) available.`;
}

async function applyTableOperation(operation) {
  const table = state.lists[Number(byId("table-list").value)];
  if (!table) throw new Error("Select a table list first");
  let row;
  try { row = JSON.parse(byId("table-row").value); } catch { throw new Error("Row is not valid JSON"); }
  const previewResponse = await sendToContent({ type: "siem:table-preview", operation, table, row });
  const preview = previewResponse.preview;
  if (!confirm(`${operation === "remove" ? "Remove" : "Add"} this row in ${preview.tableName}?\n${JSON.stringify(preview.row)}`)) return;
  await sendToContent({ type: "siem:table-apply", preview, confirmed: true });
  byId("tools-output").textContent = "Operation completed.";
}

async function initialize() {
  [state.tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const savedPanel = await loadTabSession();
  const settingsResponse = await browser.runtime.sendMessage({ type: "settings:get" });
  if (!settingsResponse?.ok) throw new Error(settingsResponse?.error ?? "ApePatrol settings are unavailable");
  state.settings = settingsResponse.settings;
  state.context = await sendToContent({ type: "siem:get-context" });
  if (!state.aiChat.selectedFields.length) state.aiChat.selectedFields = [...state.settings.ai.selectedFields];
  applyFeatureVisibility();
  renderEvent();
  renderAiChat();
  await loadAiWorkspaceChoices();
  const optional = await loadOptionalPopupFeatures({ settings: state.settings, context: state.context, request: sendToContent });
  if (optional.related?.ok) {
    state.related = optional.related.value.actions;
    renderRelated();
  } else if (optional.related) {
    showError(byId("related-output"), optional.related.error);
  } else if (state.settings.features.relatedEvents) {
    renderRelated();
  }
  if (optional.incident?.ok) {
    state.incident = optional.incident.value.incident;
    renderIncidentContext();
  } else if (optional.incident) {
    showError(byId("incident-output"), optional.incident.error);
  }
  if (optional.rule?.ok) {
    state.knowledgeBaseUrl = optional.rule.value.knowledgeBaseUrl;
    state.rule = optional.rule.value.rule;
    byId("open-rule").disabled = !state.knowledgeBaseUrl;
    renderRuleIntelligence();
  } else if (optional.rule) {
    byId("open-rule").disabled = true;
    byId("open-rule").title = optional.rule.error?.message ?? "Rule context is unavailable";
  }
  const saved = byId(savedPanel);
  switchPanel(saved?.classList.contains("panel") && !saved.hidden ? savedPanel : "event");
}

document.querySelectorAll("nav button").forEach((button) => button.addEventListener("click", () => switchPanel(button.dataset.panel)));
byId("copy-json").addEventListener("click", () => navigator.clipboard.writeText(JSON.stringify(state.context.event, null, 2)));
byId("download-json").addEventListener("click", () => downloadEvent().catch((error) => showError(byId("event-json"), error)));
byId("copy-link").addEventListener("click", async () => navigator.clipboard.writeText(await eventLink()));
byId("open-rule").addEventListener("click", () => state.knowledgeBaseUrl && browser.runtime.sendMessage({ type: "tabs:open", url: state.knowledgeBaseUrl }));
byId("open-process-graph").addEventListener("click", () => openProcessGraph("force").catch((error) => showError(byId("process-output"), error)));
byId("open-process-timeline").addEventListener("click", () => openProcessGraph("timeline").catch((error) => showError(byId("process-output"), error)));
byId("open-workspace").addEventListener("click", () => browser.tabs.create({ url: browser.runtime.getURL("workspace.html") }));
for (const [id, type] of [["pin-current-event", "event"], ["pin-current-host", "host"], ["pin-current-account", "account"], ["pin-current-incident", "incident"]]) {
  byId(id).addEventListener("click", () => pinCurrent(type).catch((error) => showError(byId("workspace-output"), error)));
}
byId("asset-lookup").addEventListener("click", async () => {
  byId("asset-output").textContent = "Loading from the current SIEM instance…";
  try { byId("asset-output").textContent = JSON.stringify((await sendToContent({ type: "siem:asset" })).asset, null, 2); }
  catch (error) { showError(byId("asset-output"), error); }
});
byId("load-lists").addEventListener("click", () => loadLists().catch((error) => showError(byId("tools-output"), error)));
byId("custom-filter").addEventListener("change", previewCustomFilter);
byId("open-filter").addEventListener("click", () => {
  const filter = selectedFilter();
  const rendered = renderFilterTemplate(filter.template, state.context.event);
  if (rendered.ok) browser.runtime.sendMessage({ type: "tabs:open", url: buildEventSearchUrl(state.context.origin, rendered.query, state.context.event.time, filter.timeRange) });
});
byId("table-add").addEventListener("click", () => applyTableOperation("add").catch((error) => showError(byId("tools-output"), error)));
byId("table-remove").addEventListener("click", () => applyTableOperation("remove").catch((error) => showError(byId("tools-output"), error)));
byId("batch-preview").addEventListener("click", () => {
  try { previewIocBatch(); } catch (error) { showError(byId("batch-preview-output"), error); }
});
byId("batch-run").addEventListener("click", () => runIocBatch().catch((error) => showError(byId("batch-results"), error)));
byId("batch-cancel").addEventListener("click", async () => {
  if (state.batchRequestId) await browser.runtime.sendMessage({ type: "enrichment:batch:cancel", requestId: state.batchRequestId });
});
byId("ai-message").addEventListener("input", (event) => {
  state.aiChat.draft = event.target.value;
  state.aiChat.updatedAt = Date.now();
  invalidateAiPreview(); saveTabSession();
});
byId("ai-attach-current").addEventListener("click", () => {
  try {
    state.aiChat = addAiAttachment(state.aiChat, eventAiAttachment(state.context.event));
    invalidateAiPreview(); renderAiChat(); saveTabSession();
  } catch (error) { showError(byId("ai-pending-context"), error); }
});
byId("ai-allow-tools").addEventListener("change", (event) => {
  state.aiChat.allowSiemTools = event.target.checked;
  state.aiChat.updatedAt = Date.now();
  invalidateAiPreview(); saveTabSession();
});
byId("ai-clear").addEventListener("click", () => {
  if (!confirm("Очистить диалог и неприложенный контекст этой вкладки?")) return;
  state.aiChat = normalizeAiChat({ selectedFields: selectedAiFields(), allowSiemTools: state.aiChat.allowSiemTools });
  invalidateAiPreview(); renderAiChat(); saveTabSession();
});
byId("ai-promote").addEventListener("click", () => promoteAiChat().catch((error) => showError(byId("ai-promotion-status"), error)));
byId("ai-preview-button").addEventListener("click", async () => {
  byId("ai-preview-meta").textContent = "Формирую payload локально…";
  try {
    const response = await browser.runtime.sendMessage({
      type: "ai:preview",
      event: state.context.event,
      selectedFields: selectedAiFields(),
      conversation: conversationWithDraft(),
      contextType: "tab",
      allowSiemTools: state.aiChat.allowSiemTools,
    });
    if (!response?.ok) throw new Error(response?.error ?? "Не удалось сформировать AI payload");
    state.aiPreviewHash = response.preview.hash;
    byId("ai-preview").textContent = response.preview.serialized;
    const warnings = response.preview.warnings.length ? `\nПредупреждения:\n- ${response.preview.warnings.join("\n- ")}` : "\nЭвристических предупреждений нет; это не означает, что payload безопасен.";
    const omitted = response.preview.omittedMessages || response.preview.omittedAttachments
      ? ` · omitted ${response.preview.omittedMessages} messages/${response.preview.omittedAttachments} attachments`
      : "";
    byId("ai-preview-meta").textContent = `${response.preview.byteLength} UTF-8 bytes · ${response.preview.sentFields.length} event fields${omitted} · destination ${response.endpoint}${warnings}`;
    byId("ai-run").disabled = false;
  } catch (error) {
    invalidateAiPreview();
    showError(byId("ai-preview"), error);
    byId("ai-preview-meta").textContent = "";
  }
});
byId("ai-run").addEventListener("click", async () => {
  const ai = state.settings.ai;
  if (!state.aiPreviewHash) return;
  const warning = ai.mode === "full" ? "Full mode отправит все нормализованные поля. " : "";
  if (!confirm(`${warning}Отправить в ${ai.endpoint} ровно показанный выше payload?`)) return;
  const outbound = conversationWithDraft();
  byId("ai-preview-meta").textContent = "Ожидаю ответ настроенного AI endpoint…";
  try {
    const response = await browser.runtime.sendMessage({
      type: "enrichment:llm",
      event: state.context.event,
      selectedFields: selectedAiFields(),
      conversation: outbound,
      contextType: "tab",
      allowSiemTools: state.aiChat.allowSiemTools,
      previewHash: state.aiPreviewHash,
      confirmed: true,
    });
    if (!response?.ok) throw new Error(response?.error ?? "AI endpoint request failed");
    state.aiChat = appendAiMessage(state.aiChat, outbound.at(-1));
    const toolCalls = response.result.toolCalls ?? [];
    state.aiChat = appendAiMessage(state.aiChat, {
      role: "assistant",
      content: response.result.content || `Запрошены дополнительные данные SIEM: ${toolCalls.map(describeToolCall).join("; ")}`,
      toolCalls,
    });
    state.aiChat.draft = "";
    state.aiChat.pendingAttachments = [];
    state.aiChat.pendingToolCalls = toolCalls;
    state.aiChat.updatedAt = Date.now();
    invalidateAiPreview(); renderAiChat(); saveTabSession();
  } catch (error) {
    showError(byId("ai-preview-meta"), error);
  }
});

browser.storage.onChanged.addListener((changes, area) => {
  if (!state.settings || !state.context || !((area === "local" && changes[SYNC_STORAGE_KEY]) || area === "managed")) return;
  browser.runtime.sendMessage({ type: "settings:get" }).then((response) => {
    if (!response?.ok) return;
    state.settings = normalizeSettings(response.settings);
    applyFeatureVisibility();
    renderEvent();
  });
});

initialize().catch((error) => {
  setStatus("Not connected to a configured SIEM instance");
  byId("event-json").textContent = error.message;
  document.querySelectorAll("main button").forEach((button) => { button.disabled = true; });
});
