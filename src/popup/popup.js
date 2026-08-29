import { setSafeText } from "../shared/dom.js";
import { buildEqualityPredicate } from "../shared/pdql/builder.js";
import { sanitizeFilenamePart } from "../shared/url.js";
import { buildEventSearchUrl } from "../siem/features/related-events.js";
import { renderFilterTemplate } from "../siem/features/custom-filters.js";
import { loadOptionalPopupFeatures } from "./feature-loader.js";
import { normalizeSettings, SYNC_STORAGE_KEY } from "../shared/settings.js";

const state = { tab: null, context: null, settings: null, related: [], lists: [], knowledgeBaseUrl: null, aiPreviewHash: null };
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
  const defaults = new Set(state.settings.ai.selectedFields);
  for (const field of Object.keys(state.context?.event ?? {}).sort()) {
    const label = document.createElement("label");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = field;
    checkbox.checked = defaults.has(field);
    checkbox.addEventListener("change", invalidateAiPreview);
    label.append(checkbox, document.createTextNode(` ${field}`));
    fields.append(label);
  }
}

function renderEvent() {
  byId("event-json").textContent = JSON.stringify(state.context?.event ?? {}, null, 2);
  const found = Object.keys(state.context?.event ?? {}).length;
  setStatus(found
    ? `MP SIEM adapter · ${found} fields`
    : state.context?.detected
      ? "MP SIEM detected · event card is closed or still loading"
      : "Configured origin reached · MP SIEM UI not detected");
  const incidentId = state.context?.event?.incident_id;
  if (state.settings.features.incidentContext) {
    byId("incident-output").textContent = incidentId
      ? `Linked incident ID: ${incidentId}. Use the native SIEM incident action to open or modify it.`
      : "No incident link is present in the current event. Related host, account and IP searches remain available in the Related tab.";
  }
  const ai = state.settings.ai;
  byId("ai-disclosure").textContent = `Destination: ${ai.endpoint || "not configured"}. Mode: ${ai.mode}. ApePatrol will show the exact final request body before transmission; warnings are not a DLP guarantee.`;
  byId("ai-preview-button").disabled = !state.settings.features.aiAssistant || !ai.endpoint || !ai.model;
  invalidateAiPreview();
  renderAiFieldPicker();
  renderCustomFilters();
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
  const data = `data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(event, null, 2))}`;
  await browser.downloads.download({ url: data, filename: `siem-event-${timestamp}-${uuid}-${host}.json`, saveAs: true });
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
  const settingsResponse = await browser.runtime.sendMessage({ type: "settings:get" });
  if (!settingsResponse?.ok) throw new Error(settingsResponse?.error ?? "ApePatrol settings are unavailable");
  state.settings = settingsResponse.settings;
  state.context = await sendToContent({ type: "siem:get-context" });
  applyFeatureVisibility();
  renderEvent();
  const optional = await loadOptionalPopupFeatures({ settings: state.settings, context: state.context, request: sendToContent });
  if (optional.related?.ok) {
    state.related = optional.related.value.actions;
    renderRelated();
  } else if (optional.related) {
    showError(byId("related-output"), optional.related.error);
  } else if (state.settings.features.relatedEvents) {
    renderRelated();
  }
  if (optional.rule?.ok) {
    state.knowledgeBaseUrl = optional.rule.value.knowledgeBaseUrl;
    byId("open-rule").disabled = !state.knowledgeBaseUrl;
  } else if (optional.rule) {
    byId("open-rule").disabled = true;
    byId("open-rule").title = optional.rule.error?.message ?? "Rule context is unavailable";
  }
}

document.querySelectorAll("nav button").forEach((button) => button.addEventListener("click", () => switchPanel(button.dataset.panel)));
byId("copy-json").addEventListener("click", () => navigator.clipboard.writeText(JSON.stringify(state.context.event, null, 2)));
byId("download-json").addEventListener("click", () => downloadEvent().catch((error) => showError(byId("event-json"), error)));
byId("copy-link").addEventListener("click", async () => navigator.clipboard.writeText(await eventLink()));
byId("open-rule").addEventListener("click", () => state.knowledgeBaseUrl && browser.runtime.sendMessage({ type: "tabs:open", url: state.knowledgeBaseUrl }));
byId("open-process-graph").addEventListener("click", () => openProcessGraph("force").catch((error) => showError(byId("process-output"), error)));
byId("open-process-timeline").addEventListener("click", () => openProcessGraph("timeline").catch((error) => showError(byId("process-output"), error)));
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
byId("ai-preview-button").addEventListener("click", async () => {
  byId("ai-preview-meta").textContent = "Формирую payload локально…";
  const response = await browser.runtime.sendMessage({ type: "ai:preview", event: state.context.event, selectedFields: selectedAiFields() });
  if (!response?.ok) {
    showError(byId("ai-preview"), response?.error ?? "Не удалось сформировать AI payload");
    byId("ai-preview-meta").textContent = "";
    return;
  }
  state.aiPreviewHash = response.preview.hash;
  byId("ai-preview").textContent = response.preview.serialized;
  const warnings = response.preview.warnings.length ? `\nПредупреждения:\n- ${response.preview.warnings.join("\n- ")}` : "\nЭвристических предупреждений нет; это не означает, что payload безопасен.";
  byId("ai-preview-meta").textContent = `${response.preview.byteLength} UTF-8 bytes · ${response.preview.sentFields.length} fields · destination ${response.endpoint}${warnings}`;
  byId("ai-run").disabled = false;
});
byId("ai-run").addEventListener("click", async () => {
  const ai = state.settings.ai;
  if (!state.aiPreviewHash) return;
  const warning = ai.mode === "full" ? "Full mode отправит все нормализованные поля. " : "";
  if (!confirm(`${warning}Отправить в ${ai.endpoint} ровно показанный выше payload?`)) return;
  byId("ai-output").textContent = "Waiting for the configured endpoint…";
  const response = await browser.runtime.sendMessage({
    type: "enrichment:llm",
    event: state.context.event,
    selectedFields: selectedAiFields(),
    previewHash: state.aiPreviewHash,
    confirmed: true,
  });
  setSafeText(byId("ai-output"), response.ok ? response.result.content : response.error);
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes[SYNC_STORAGE_KEY] || !state.settings || !state.context) return;
  state.settings = normalizeSettings(changes[SYNC_STORAGE_KEY].newValue);
  applyFeatureVisibility();
  renderEvent();
});

initialize().catch((error) => {
  setStatus("Not connected to a configured SIEM instance");
  byId("event-json").textContent = error.message;
  document.querySelectorAll("main button").forEach((button) => { button.disabled = true; });
});
