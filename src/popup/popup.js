import { extractPreferredHash } from "../shared/hash.js";
import { setSafeText } from "../shared/dom.js";
import { buildEqualityPredicate } from "../shared/pdql/builder.js";
import { sanitizeFilenamePart } from "../shared/url.js";
import { buildEventSearchUrl } from "../siem/features/related-events.js";
import { renderFilterTemplate } from "../siem/features/custom-filters.js";

const state = { tab: null, context: null, settings: null, related: [], graph: null, processMode: "tree", processScale: 1, collapsed: new Set(), lists: [], knowledgeBaseUrl: null };
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
  const hash = extractPreferredHash(state.context?.event?.["object.hash"] ?? "");
  byId("vt-lookup").disabled = !hash;
  const ai = state.settings.ai;
  byId("ai-disclosure").textContent = `Destination: ${ai.endpoint || "not configured"}. Mode: ${ai.mode}. Fields currently visible: ${Object.keys(state.context?.event ?? {}).join(", ") || "none"}. Nothing is sent until you click below and confirm.`;
  byId("ai-run").disabled = !state.settings.features.aiAssistant || !ai.endpoint;
  renderCustomFilters();
}

function renderCustomFilters() {
  const select = byId("custom-filter");
  select.replaceChildren();
  for (const filter of state.settings.customFilters.filter((item) => item.enabled)) {
    const option = document.createElement("option");
    option.value = filter.id;
    option.textContent = filter.name;
    select.append(option);
  }
  previewCustomFilter();
}

function selectedFilter() { return state.settings.customFilters.find((filter) => filter.id === byId("custom-filter").value); }
function previewCustomFilter() {
  const filter = selectedFilter();
  const rendered = filter ? renderFilterTemplate(filter.template, state.context.event) : { ok: false, missing: [] };
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

function renderProcess() {
  const output = byId("process-output");
  output.replaceChildren();
  output.style.fontSize = `${state.processScale}em`;
  if (!state.graph) { output.textContent = "Build a bounded process graph for the current host."; return; }
  const search = byId("process-search").value.toLowerCase();
  const nodes = [...state.graph.nodes].sort(state.processMode === "timeline" ? (a, b) => a.time - b.time : (a, b) => a.depth - b.depth || a.time - b.time);
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const hiddenByCollapse = (node) => {
    let parentId = node.parentId;
    while (parentId) {
      if (state.collapsed.has(parentId)) return true;
      parentId = nodeMap.get(parentId)?.parentId;
    }
    return false;
  };
  for (const node of nodes) {
    const event = node.event;
    const label = `${event.time ?? ""} · PID ${event["object.process.id"] ?? "?"} · ${event["object.process.cmdline"] ?? event["object.process.name"] ?? "unknown"}`;
    if (search && !label.toLowerCase().includes(search)) continue;
    if (!search && state.processMode === "tree" && hiddenByCollapse(node)) continue;
    const row = document.createElement("div");
    row.className = `process-row${event.uuid === state.context.event.uuid ? " source" : ""}`;
    if (state.processMode === "tree") row.style.paddingInlineStart = `${8 + Math.min(node.depth, 20) * 14}px`;
    const text = document.createElement("span");
    text.textContent = label;
    row.title = JSON.stringify(event, null, 2);
    const controls = document.createElement("span");
    if (state.processMode === "tree" && node.children.length) {
      const collapse = document.createElement("button");
      collapse.textContent = state.collapsed.has(node.id) ? "▸" : "▾";
      collapse.title = "Collapse or expand children";
      collapse.addEventListener("click", () => { state.collapsed.has(node.id) ? state.collapsed.delete(node.id) : state.collapsed.add(node.id); renderProcess(); });
      controls.append(collapse);
    }
    const copy = document.createElement("button");
    copy.textContent = "Copy";
    copy.title = "Copy PID, GUID and command line";
    copy.addEventListener("click", () => navigator.clipboard.writeText(JSON.stringify({ pid: event["object.process.id"], guid: event["object.process.guid"], cmdline: event["object.process.cmdline"] }, null, 2)));
    const open = document.createElement("button");
    open.textContent = "Open";
    open.title = "Open the related process-start event";
    open.addEventListener("click", () => event.uuid && browser.runtime.sendMessage({ type: "tabs:open", url: buildEventSearchUrl(state.context.origin, buildEqualityPredicate("uuid", event.uuid), event.time, "15m") }));
    controls.append(copy, open);
    row.append(text, controls);
    output.append(row);
  }
  if (state.graph.truncated) {
    const note = document.createElement("p"); note.textContent = "Result was truncated at the configured node limit."; output.prepend(note);
  }
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
  renderProcess();
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
byId("load-process").addEventListener("click", async () => {
  byId("process-output").textContent = "Building graph…";
  try { state.graph = (await sendToContent({ type: "siem:process" })).graph; renderProcess(); } catch (error) { showError(byId("process-output"), error); }
});
byId("process-search").addEventListener("input", renderProcess);
byId("process-tree-mode").addEventListener("click", () => { state.processMode = "tree"; renderProcess(); });
byId("process-timeline-mode").addEventListener("click", () => { state.processMode = "timeline"; renderProcess(); });
byId("process-zoom-out").addEventListener("click", () => { state.processScale = Math.max(.7, state.processScale - .1); renderProcess(); });
byId("process-zoom-in").addEventListener("click", () => { state.processScale = Math.min(1.6, state.processScale + .1); renderProcess(); });
byId("vt-lookup").addEventListener("click", async () => {
  const hash = extractPreferredHash(state.context.event["object.hash"] ?? "");
  try {
    const response = await browser.runtime.sendMessage({ type: "enrichment:virustotal", hash });
    if (!response.ok) throw new Error(response.error);
    byId("enrichment-output").textContent = JSON.stringify(response.result, null, 2);
  } catch (error) { showError(byId("enrichment-output"), error); }
});
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
