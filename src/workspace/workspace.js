import { mountWorkspace } from "@isaiandco/ape-share-core/ui/workspace";
import { workspaceToJson, workspaceToMarkdown } from "../shared/workspace.js";
import { buildEqualityPredicate } from "../shared/pdql/builder.js";
import { buildEventSearchUrl } from "../siem/features/related-events.js";
import { downloadText } from "../shared/download.js";
import { buildEntitySearchPredicate, buildInvestigationGraph, describeInvestigationEvent, INVESTIGATION_EVENT_FIELDS } from "../shared/investigation-graph.js";
import { SiemApiClient, filterAvailableEventFields } from "../siem/api/client.js";
import { createWorkspaceSiemFetch } from "../content/siem-transport.js";
import { requestAiCompletion } from "../shared/ai-request.js";

const FORCE_KEY = "apepatrol.processGraph.forceSettings.v1";
mountWorkspace(document, {
  filenamePrefix: "apepatrol", workspaceToJson, workspaceToMarkdown, downloadText, requestAiCompletion,
  buildInvestigationGraph, describeInvestigationEvent,
  async request(message) {
    const response = await browser.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error ?? "Workspace operation failed");
    return response;
  },
  loadForceSettings() { try { return JSON.parse(localStorage.getItem(FORCE_KEY) || "null"); } catch { return null; } },
  saveForceSettings(settings) { try { localStorage.setItem(FORCE_KEY, JSON.stringify(settings)); } catch { /* optional preference */ } },
  eventTime: event => event?.time,
  eventIdentity: event => String(event.uuid ?? JSON.stringify(event)),
  eventItem(event) { const view = describeInvestigationEvent(event); return { type: "event", value: String(event.uuid ?? `${event.time}:${view.title}`), label: view.title, sourceEventUuid: event.uuid ?? null, snapshot: event }; },
  canSearch: workspace => Boolean(workspace?.siemOrigin),
  canOpenEvent: (workspace, item) => Boolean(workspace?.siemOrigin && (item?.sourceEventUuid ?? item?.snapshot?.uuid)),
  async openEvent(workspace, item) {
    const url = buildEventSearchUrl(workspace.siemOrigin, buildEqualityPredicate("uuid", item.sourceEventUuid ?? item.snapshot.uuid), item.snapshot?.time, "15m");
    await browser.runtime.sendMessage({ type: "tabs:open", url });
  },
  async searchEntities(workspace, selected, { mode, period, limit }) {
    const client = new SiemApiClient(workspace.siemOrigin, { fetchImpl: createWorkspaceSiemFetch({ workspaceId: workspace.id, origin: workspace.siemOrigin }), xhrFactory: null });
    const metadata = await client.getEventMetadata();
    const available = new Set((metadata?.fields ?? []).filter(field => field.filterable === true).map(field => field.name));
    const searchable = selected.map(node => ({ ...node, queryFields: node.queryFields.filter(field => available.has(field)) })).filter(node => node.queryFields.length);
    if (searchable.length !== selected.length) throw new Error("Выбранные сущности недоступны для фильтрации в этой версии SIEM");
    const where = buildEntitySearchPredicate(searchable, mode);
    if (!where) throw new Error("Выбранные свойства недоступны для фильтрации");
    const response = await client.searchEvents({ where, select: filterAvailableEventFields(metadata, INVESTIGATION_EVENT_FIELDS), timeFrom: period.from, timeTo: period.to, limit });
    return { events: Array.isArray(response) ? response : response?.events ?? [], query: where };
  },
});
