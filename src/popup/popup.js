import { setSafeText } from "../shared/dom.js";
import { buildEqualityPredicate } from "../shared/pdql/builder.js";
import { sanitizeFilenamePart } from "../shared/url.js";
import { buildEventSearchUrl } from "../siem/features/related-events.js";
import { renderFilterTemplate } from "../siem/features/custom-filters.js";

const state = { tab: null, context: null, settings: null, related: [], lists: [], knowledgeBaseUrl: null };
const byId = (id) => document.getElementById(id);
const setStatus = (message) => { byId("status").textContent = message; };
const showError = (target, error) => { setSafeText(target, error?.message ?? String(error)); };

async function sendToContent(message) {
  if (!state.tab?.id) throw new Error("No active tab");
  try {
    const response = await browser.tabs.sendMessage(state.tab.id, message);
    if (!response?.ok) throw new Error(response?.error ?? "Feature unavailable on this page");
    return response;
  } catch (error) {
    throw new Error(error.message.includes("Receiving end") ? "Open a configured MaxPatrol SIEM event page" : error.message);
  }
}

function switchPanel(id) {
  document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === id));
  document.querySelectorAll("nav button").forEach((button) => button.classList.toggle("active", button.dataset.panel === id));
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
  byId("incident-output").textContent = incidentId
    ? `Linked incident ID: ${incidentId}. Use the native SIEM incident action to open or modify it.`
    : "No incident link is present in the current event. Related host, account and IP searches remain available in the Related tab.";
  const ai = state.settings.ai;
  byId("ai-disclosure").textContent = `Destination: ${ai.endpoint || "not configured"}. Mode: ${ai.mode}. Fields currently visible: ${Object.keys(state.context?.event ?? {}).join(", ") || "none"}. Nothing is sent until you click below and confirm.`;
  byId("ai-run").disabled = !state.settings.features.aiAssistant || !ai.endpoint;
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
  const search = new URLSearchParams({ tabId: String(state.tab.id), layout });
  await browser.tabs.create({ url: browser.runtime.getURL(`process-graph.html?${search}`) });
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
  state.settings = settingsResponse.settings;
  state.context = await sendToContent({ type: "siem:get-context" });
  renderEvent();
  const related = await sendToContent({ type: "siem:related" });
  state.related = related.actions;
  renderRelated();
  if (state.context.event.correlation_name) {
    const ruleContext = await sendToContent({ type: "siem:rule-context" });
    state.knowledgeBaseUrl = ruleContext.knowledgeBaseUrl;
    byId("open-rule").disabled = !state.knowledgeBaseUrl;
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
byId("ai-run").addEventListener("click", async () => {
  const ai = state.settings.ai;
  if (!confirm(`Send the ${ai.mode} event to ${ai.endpoint}?`)) return;
  byId("ai-output").textContent = "Waiting for the configured endpoint…";
  const response = await browser.runtime.sendMessage({ type: "enrichment:llm", event: state.context.event, confirmed: true });
  setSafeText(byId("ai-output"), response.ok ? response.result.content : response.error);
});

initialize().catch((error) => {
  setStatus("Not connected to a configured SIEM instance");
  byId("event-json").textContent = error.message;
  document.querySelectorAll("main button").forEach((button) => { button.disabled = true; });
});
