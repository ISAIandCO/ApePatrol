import { createLogger } from "../shared/logger.js";
import { normalizeSettings, SYNC_STORAGE_KEY } from "../shared/settings.js";
import { filterAvailableEventFields, SiemApiClient } from "../siem/api/client.js";
import { detectCapabilities } from "../siem/api/capabilities.js";
import { SiemDomController } from "../siem/dom/controller.js";
import { SiemDomAdapter } from "../siem/dom/r27_3.js";
import { EdrUiFeature } from "../siem/features/edr-ui.js";
import { getAssetContext } from "../siem/features/asset-enrichment.js";
import { EventFieldActions } from "../siem/features/event-actions.js";
import { FieldAliasesFeature } from "../siem/features/field-aliases.js";
import { IocDescriptionFeature } from "../siem/features/ioc-description.js";
import { resolveIncidentContext } from "../siem/features/incident-context.js";
import { PdqlAutocompleteFeature } from "../siem/features/pdql-autocomplete.js";
import { resolveKnowledgeBaseUrl } from "../siem/features/knowledge-base.js";
import { buildEventSearchUrl, buildRelatedEventActions, resolveAiRelatedRequest, TIME_PRESETS } from "../siem/features/related-events.js";
import { TableListTools } from "../siem/features/table-list-tools.js";
import { buildRuleIntelligence } from "../siem/features/rule-intelligence.js";
import { createProcessWorkflow } from "@isaiandco/ape-share-core/graph/workflow";
import { buildProcessRelationPredicate, buildProcessSearchPredicate, normalizeProcessEvent } from "../siem/process/graph.js";
import { createSiemBackgroundFetch } from "./siem-transport.js";
import { domSettingsFingerprint, settingsImpact } from "./settings-runtime.js";
import { ERROR_CODES, normalizeError } from "../shared/errors.js";
import { aroundTime } from "../shared/time.js";

const PROCESS_FIELDS = [
  "uuid", "time", "msgid", "event_src.host", "object.id", "object.name",
  "object.process.id", "object.process.parent.id", "object.process.guid", "object.process.parent.guid",
  "subject.process.id", "subject.process.parent.id", "subject.process.guid", "subject.process.parent.guid",
  "object.process.name", "object.process.parent.name", "object.process.cmdline", "subject.process.name", "subject.process.cmdline",
  "object.process.path", "subject.process.path", "subject.account.name", "object.account.name",
  "object.account.session_id", "correlation_name",
];
const AI_RELATED_FIELDS = [
  "uuid", "time", "msgid", "event_src.host", "event_src.title", "event_src.category", "category", "severity",
  "correlation_name", "subject.account.name", "object.account.name", "src.ip", "dst.ip", "object.process.name",
  "object.process.path", "object.process.cmdline", "object.process.guid", "subject.process.guid", "object.hash",
];

async function initialize() {
  const response = await browser.runtime.sendMessage({ type: "settings:get" });
  if (!response?.ok || !response.settings.instances.includes(location.origin)) return;
  let settings = normalizeSettings(response.settings);
  let logger = createLogger(settings.debugLogging, { module: "content" });
  let active = true;
  await browser.runtime.sendMessage({ type: "content:ready" });

  const adapter = new SiemDomAdapter();
  const client = new SiemApiClient(location.origin, {
    fetchImpl: createSiemBackgroundFetch(),
    xhrFactory: null,
    timeout: 30000,
  });
  const tableTools = new TableListTools(client);
  const processQueries = new Map();
  let controller = null;
  let domFingerprint = null;
  const mountDomFeatures = () => {
    const nextFingerprint = domSettingsFingerprint(settings);
    if (controller && nextFingerprint === domFingerprint) return;
    controller?.stop();
    controller = new SiemDomController(adapter, [
      new EventFieldActions(settings, client),
      new FieldAliasesFeature(settings.fieldAliases),
      new EdrUiFeature(settings.features.disableEdrIntegration),
      new IocDescriptionFeature(client, settings, logger),
      new PdqlAutocompleteFeature(client),
    ]);
    domFingerprint = nextFingerprint;
    controller.start();
  };
  mountDomFeatures();
  const capabilitiesPromise = detectCapabilities(client).catch((error) => {
    logger.debug("Capability detection failed", { kind: error.kind });
    return {};
  });

  browser.runtime.onMessage.addListener(async (message) => {
    try {
      if (!active && message?.type?.startsWith("siem:")) {
        return { ok: false, error: "This SIEM origin is no longer configured", kind: "feature-unavailable" };
      }
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
        case "siem:incident-context": {
          if (!settings.features.incidentContext) return { ok: false, error: "Incident context is disabled", kind: "feature-unavailable" };
          const request = (scope) => resolveIncidentContext(client, event, { scope });
          let incident;
          try {
            incident = await request(processScope(settings));
          } catch (error) {
            if (settings.searchScope.mode === "default" || !["http", "unsupported", "invalid-response"].includes(error.kind)) throw error;
            incident = await request({});
          }
          return { ok: true, incident };
        }
        case "siem:ai-related":
          if (!settings.features.relatedEvents) return { ok: false, error: "Related events are disabled", kind: "feature-unavailable" };
          return { ok: true, ...(await fetchAiRelatedEvents(client, event, settings, message.arguments)) };
        case "siem:process": {
          if (!settings.features.processTree) return { ok: false, error: "Process graph is disabled", kind: "feature-unavailable" };
          const requestId = String(message.requestId ?? "");
          if (requestId && (!/^[a-f\d-]{8,64}$/i.test(requestId) || processQueries.has(requestId))) throw new TypeError("Invalid or duplicate process query ID");
          const controller = new AbortController();
          if (requestId) processQueries.set(requestId, controller);
          try { return await buildProcessContext(client, event, settings, message.mode, controller.signal); }
          finally { if (requestId) processQueries.delete(requestId); }
        }
        case "siem:process:expand": {
          if (!settings.features.processTree) return { ok: false, error: "Process graph is disabled", kind: "feature-unavailable" };
          const requestId = String(message.requestId ?? "");
          if (!/^[a-f\d-]{8,64}$/i.test(requestId) || processQueries.has(requestId)) throw new TypeError("Invalid or duplicate process query ID");
          const abortController = new AbortController();
          processQueries.set(requestId, abortController);
          try {
            return await expandProcessContext(client, event, settings, message, abortController.signal);
          } finally {
            processQueries.delete(requestId);
          }
        }
        case "siem:process:expand-node": {
          if (!settings.features.processTree) return { ok: false, error: "Process graph is disabled", kind: "feature-unavailable" };
          const requestId = String(message.requestId ?? "");
          if (!/^[a-f\d-]{8,64}$/i.test(requestId) || processQueries.has(requestId)) throw new TypeError("Invalid or duplicate process query ID");
          const abortController = new AbortController();
          processQueries.set(requestId, abortController);
          try {
            return await expandProcessNode(client, event, settings, message, abortController.signal);
          } finally {
            processQueries.delete(requestId);
          }
        }
        case "siem:process:cancel": {
          const controller = processQueries.get(String(message.requestId ?? ""));
          if (controller) controller.abort(new DOMException("Process query cancelled", "AbortError"));
          return { ok: true, cancelled: Boolean(controller) };
        }
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
          if (!settings.features.ruleIntelligence) return { ok: false, error: "Rule Intelligence is disabled", kind: "feature-unavailable" };
          if (!event.correlation_name) return { ok: true, rule: null, knowledgeBaseUrl: null };
          const [rule, applications] = await Promise.all([
            client.getCorrelationRule(event.correlation_name),
            client.getRegisteredApplications(),
          ]);
          const knowledgeBaseUrl = resolveKnowledgeBaseUrl(applications, rule);
          return { ok: true, rule: buildRuleIntelligence(rule, event, knowledgeBaseUrl), knowledgeBaseUrl };
        }
        default:
          return undefined;
      }
    } catch (error) {
      const normalized = normalizeError(error, ERROR_CODES.SIEM_API_ERROR);
      return { ok: false, error: normalized.message, errorCode: normalized.code, kind: error.kind ?? "feature-unavailable" };
    }
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (!((area === "local" && changes[SYNC_STORAGE_KEY]) || area === "managed")) return;
    Promise.resolve().then(async () => {
      const response = await browser.runtime.sendMessage({ type: "settings:get" });
      if (!response?.ok) throw new Error(response?.error ?? "Live settings are unavailable");
      const next = normalizeSettings(response.settings);
      const impact = settingsImpact(settings, next, location.origin);
      settings = next;
      active = impact.active;
      logger = createLogger(settings.debugLogging, { module: "content" });
      if (!active) {
        controller?.stop();
        controller = null;
        domFingerprint = null;
        return;
      }
      if (impact.clearApiCache) client.clearCache();
      if (impact.rebuildDom) mountDomFeatures();
    }).catch((error) => console.warn(`[ApePatrol] live settings update failed: ${error.message}`));
  });
}

async function fetchAiRelatedEvents(client, event, settings, input = {}) {
  const { relation, range, limit, action } = resolveAiRelatedRequest(event, input);
  let select;
  try { select = filterAvailableEventFields(await client.getEventMetadata(), AI_RELATED_FIELDS); }
  catch { select = AI_RELATED_FIELDS; }
  const request = (scope) => client.searchEvents({ where: action.where, select, ...aroundTime(event.time, TIME_PRESETS[range]), limit, scope });
  let response;
  try {
    response = await request(processScope(settings));
  } catch (error) {
    if (settings.searchScope.mode === "default" || !["http", "unsupported", "invalid-response"].includes(error.kind)) throw error;
    response = await request({});
  }
  const events = (Array.isArray(response) ? response : Array.isArray(response?.events) ? response.events : []).slice(0, limit);
  return { relation, range, label: action.label, where: action.where, events, truncated: events.length >= limit };
}

function processWorkflow(client, settings) {
  return createProcessWorkflow({
    origin: client.origin,
    normalize: normalizeProcessEvent,
    async searchPage(query) {
      const intent = query.where;
      const where = intent.kind === "processes" ? buildProcessSearchPredicate(intent.host)
        : buildProcessRelationPredicate(intent.events, intent.direction);
      const select = await processFields(client);
      const request = scope => client.searchEvents({ ...query, where, select, scope });
      try { return await request(processScope(settings)); }
      catch (error) {
        if (settings.searchScope.mode === "default" || !["http", "unsupported", "invalid-response"].includes(error.kind)) throw error;
        return request({});
      }
    },
  }, settings);
}

async function buildProcessContext(client, event, settings, mode, signal) {
  return processWorkflow(client, settings).load(event, mode, signal);
}
async function expandProcessContext(client, event, settings, message, signal) {
  return processWorkflow(client, settings).expand(event, message, signal);
}
async function expandProcessNode(client, event, settings, message, signal) {
  return processWorkflow(client, settings).expandNode(event, message, signal);
}

function processScope(settings) {
  return settings.searchScope.mode === "selected" ? {
    searchType: "selected",
    searchSources: settings.searchScope.searchSources,
    localSources: settings.searchScope.localSources,
    groupIds: settings.searchScope.groupIds,
  } : settings.searchScope.mode === "all" ? { searchType: "all" } : {};
}

async function processFields(client) {
  try {
    return filterAvailableEventFields(await client.getEventMetadata(), PROCESS_FIELDS);
  } catch {
    return PROCESS_FIELDS;
  }
}


initialize().catch((error) => console.warn(`[ApePatrol] initialization failed: ${error.message}`));
