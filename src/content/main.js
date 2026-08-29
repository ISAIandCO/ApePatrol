import { createLogger } from "../shared/logger.js";
import { aroundTime } from "../shared/time.js";
import { SiemApiClient } from "../siem/api/client.js";
import { detectCapabilities } from "../siem/api/capabilities.js";
import { SiemDomController } from "../siem/dom/controller.js";
import { SiemDomAdapter } from "../siem/dom/r27_3.js";
import { EdrUiFeature } from "../siem/features/edr-ui.js";
import { getAssetContext } from "../siem/features/asset-enrichment.js";
import { EventFieldActions } from "../siem/features/event-actions.js";
import { FieldAliasesFeature } from "../siem/features/field-aliases.js";
import { IocDescriptionFeature } from "../siem/features/ioc-description.js";
import { resolveKnowledgeBaseUrl } from "../siem/features/knowledge-base.js";
import { buildEventSearchUrl, buildRelatedEventActions } from "../siem/features/related-events.js";
import { TableListTools } from "../siem/features/table-list-tools.js";
import { buildProcessGraph, buildProcessSearchPredicate, findSourceProcessNodeId } from "../siem/process/graph.js";
import { createSiemBackgroundFetch } from "./siem-transport.js";

const PROCESS_FIELDS = [
  "uuid", "time", "msgid", "event_src.host", "object.id", "object.name",
  "object.process.id", "object.process.parent.id", "object.process.guid", "object.process.parent.guid",
  "subject.process.id", "subject.process.parent.id", "subject.process.guid", "subject.process.parent.guid",
  "object.process.name", "object.process.parent.name", "object.process.cmdline", "subject.process.name", "subject.process.cmdline",
  "object.process.path", "subject.process.path", "subject.account.name", "object.account.name",
  "object.account.session_id", "correlation_name",
];

async function initialize() {
  const response = await browser.runtime.sendMessage({ type: "settings:get" });
  if (!response?.ok || !response.settings.instances.includes(location.origin)) return;
  const settings = response.settings;
  const logger = createLogger(settings.debugLogging);
  await browser.runtime.sendMessage({ type: "content:ready" });

  const adapter = new SiemDomAdapter();
  const client = new SiemApiClient(location.origin, {
    fetchImpl: createSiemBackgroundFetch(),
    xhrFactory: null,
    timeout: 30000,
  });
  const tableTools = new TableListTools(client);
  const features = [
    new EventFieldActions(settings),
    new FieldAliasesFeature(settings.fieldAliases),
    new EdrUiFeature(settings.features.disableEdrIntegration),
    new IocDescriptionFeature(client, settings, logger),
  ];
  const controller = new SiemDomController(adapter, features);
  controller.start();
  const capabilitiesPromise = detectCapabilities(client).catch((error) => {
    logger.debug("Capability detection failed", { kind: error.kind });
    return {};
  });

  browser.runtime.onMessage.addListener(async (message) => {
    try {
      const event = adapter.extractEvent();
      switch (message?.type) {
        case "siem:get-context":
          return { ok: true, origin: location.origin, event, detected: adapter.detect(), capabilities: await capabilitiesPromise };
        case "siem:related": {
          if (!settings.features.relatedEvents) return { ok: false, error: "Related events are disabled", kind: "feature-unavailable" };
          const actions = buildRelatedEventActions(event).map((action) => ({
            ...action,
            urls: Object.fromEntries(["5m", "15m", "1h", "24h"].map((preset) => [preset, buildEventSearchUrl(location.origin, action.where, event.time, preset)])),
          }));
          return { ok: true, actions };
        }
        case "siem:process":
          if (!settings.features.processTree) return { ok: false, error: "Process graph is disabled", kind: "feature-unavailable" };
          return await buildProcessContext(client, event, settings);
        case "siem:table-lists":
          if (!settings.features.tableListTools) return { ok: false, error: "Table List tools are disabled", kind: "feature-unavailable" };
          return { ok: true, lists: await tableTools.list() };
        case "siem:table-preview":
          return { ok: true, preview: tableTools.preview(message.operation, message.table, message.row) };
        case "siem:table-apply":
          if (!settings.features.tableListTools) return { ok: false, error: "Table List tools are disabled", kind: "feature-unavailable" };
          return browser.runtime.sendMessage({
            type: "siem:table-list:apply",
            operation: message.preview?.operation,
            token: message.preview?.token,
            row: message.preview?.row,
            confirmed: message.confirmed === true,
          });
        case "siem:asset": {
          const capabilities = await capabilitiesPromise;
          const asset = await getAssetContext(client, {
            assetId: event["asset.id"] ?? event["event_src.asset.id"] ?? event["src.asset.id"] ?? event["dst.asset.id"],
            assetName: event["event_src.asset"] ?? event["src.asset"] ?? event["dst.asset"] ?? event["event_src.host"],
            includeEdr: capabilities.edr === true && !settings.features.disableEdrIntegration,
          });
          return { ok: true, asset };
        }
        case "siem:rule-context": {
          if (!event.correlation_name) return { ok: true, rule: null, knowledgeBaseUrl: null };
          const [rule, applications] = await Promise.all([
            client.getCorrelationRule(event.correlation_name),
            client.getRegisteredApplications(),
          ]);
          return { ok: true, rule: { objectId: rule?.objectId ?? rule?.id ?? null }, knowledgeBaseUrl: resolveKnowledgeBaseUrl(applications, rule) };
        }
        default:
          return undefined;
      }
    } catch (error) {
      return { ok: false, error: error.message, kind: error.kind ?? "feature-unavailable" };
    }
  });
}

async function buildProcessContext(client, event, settings) {
  const host = event["event_src.host"];
  if (!host) return { ok: false, kind: "feature-unavailable", error: "Current event has no event_src.host" };
  const where = buildProcessSearchPredicate(host);
  const range = aroundTime(event.time, 86400);
  const scope = settings.searchScope.mode === "selected" ? {
    searchType: "selected",
    searchSources: settings.searchScope.searchSources,
    localSources: settings.searchScope.localSources,
    groupIds: settings.searchScope.groupIds,
  } : settings.searchScope.mode === "all" ? { searchType: "all" } : {};
  const request = (requestScope) => client.searchEvents({
    where, select: PROCESS_FIELDS, ...range, scope: requestScope,
    limit: settings.process.maxNodes,
  });
  let result;
  try {
    result = await request(scope);
  } catch (error) {
    if (settings.searchScope.mode === "default" || !["http", "unsupported", "invalid-response"].includes(error.kind)) throw error;
    result = await request({});
  }
  const events = Array.isArray(result) ? result : result?.events ?? [];
  const graph = buildProcessGraph(events, settings.process);
  return {
    ok: true,
    graph,
    origin: client.origin,
    sourceUuid: event.uuid ?? null,
    sourceNodeId: findSourceProcessNodeId(graph, event),
  };
}

initialize().catch((error) => console.warn(`[ApePatrol] initialization failed: ${error.message}`));
