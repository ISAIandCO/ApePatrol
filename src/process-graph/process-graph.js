import { mountProcessGraph } from "@isaiandco/ape-share-core/ui/process-graph";
import { buildProcessGraphView } from "../siem/process/view-model.js";
import { buildEqualityPredicate } from "../shared/pdql/builder.js";
import { buildEventSearchUrl } from "../siem/features/related-events.js";

const params = new URLSearchParams(location.search);
let sourceTabId = Number(params.get("tabId"));
const snapshotId = params.get("snapshotId");
const key = "apepatrol.processGraph.forceSettings.v1";
const runtime = async message => {
  const result = await browser.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error ?? "Не удалось выполнить действие");
  return result;
};
const query = async message => {
  const result = await browser.tabs.sendMessage(sourceTabId, message);
  if (!result?.ok) throw new Error(result?.error ?? "SIEM не вернула данные");
  return result;
};
function expansion(type, input) {
  return query({ type, requestId: input.requestId, direction: input.direction,
    resumeLimit: input.resumeLimit, stepSeconds: input.stepSeconds, nodeLimit: input.nodeLimit,
    nodeEvent: input.node?.event, sourceEvent: input.response.sourceEvent,
    queryMetadata: input.response.queryMetadata, existingEvents: input.response.graph.nodes.map(node => node.event) });
}
const view = mountProcessGraph(document, {
  search: location.search,
  buildView: buildProcessGraphView,
  isAvailable: () => Number.isInteger(sourceTabId) && sourceTabId > 0,
  loadForceSettings: () => JSON.parse(localStorage.getItem(key) ?? "{}"),
  saveForceSettings: value => localStorage.setItem(key, JSON.stringify(value)),
  load: ({ mode, requestId }) => query({ type: "siem:process", mode, requestId }),
  expand: input => expansion("siem:process:expand", input),
  expandNode: input => expansion("siem:process:expand-node", input),
  cancel: requestId => query({ type: "siem:process:cancel", requestId }),
  async saveSnapshot(response) {
    if (snapshotId) await runtime({ type: "graph:snapshot:update", id: snapshotId, snapshot: { sourceTabId, sourceEvent: response.sourceEvent, response } });
  },
  async loadSnapshot() {
    if (!snapshotId) return null;
    const { snapshot } = await runtime({ type: "graph:snapshot:get", id: snapshotId });
    if (!snapshot) return null;
    let stale = !Number.isInteger(sourceTabId) || sourceTabId <= 0;
    if (!stale) { try { await browser.tabs.get(sourceTabId); } catch { stale = true; } }
    return { ...snapshot, stale };
  },
  async reconnect(state) {
    if (!state.origin) throw new Error("В снимке отсутствует адрес SIEM");
    const tabs = await browser.tabs.query({ url: state.origin + "/*" });
    const tab = tabs.find(item => item.active) ?? tabs[0];
    if (!tab?.id) throw new Error("Нет открытой вкладки " + state.origin);
    const context = await browser.tabs.sendMessage(tab.id, { type: "siem:get-context" });
    if (!context?.ok || context.origin !== state.origin) throw new Error("Вкладка не отвечает как настроенный MP SIEM");
    sourceTabId = tab.id;
  },
  subscribeUnavailable(handler) {
    const listener = id => { if (id === sourceTabId) handler(); };
    browser.tabs.onRemoved.addListener(listener);
    return () => browser.tabs.onRemoved.removeListener(listener);
  },
  async pin(node, state) {
    const result = await runtime({ type: "workspace:item:add", siemOrigin: state.origin,
      sourceIncidentId: state.response?.sourceEvent?.incident_id ?? null,
      item: { type: "process", value: String(node.event?.uuid ?? node.id), label: node.label,
        sourceEventUuid: node.event?.uuid ?? null, snapshot: node.event } });
    return result.workspace.title;
  },
  async open(node, state) {
    if (!node.event?.uuid || !state.origin) throw new Error("У процесса нет UUID события или адреса SIEM");
    await runtime({ type: "tabs:open", url: buildEventSearchUrl(state.origin, buildEqualityPredicate("uuid", node.event.uuid), node.event.time, "15m") });
  },
  openWorkspace: () => browser.tabs.create({ url: browser.runtime.getURL("workspace.html") }),
});
window.addEventListener("pagehide", () => view.destroy(), { once: true });
