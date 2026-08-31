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
import { resolveKnowledgeBaseUrl } from "../siem/features/knowledge-base.js";
import { buildEventSearchUrl, buildRelatedEventActions } from "../siem/features/related-events.js";
import { TableListTools } from "../siem/features/table-list-tools.js";
import { buildRuleIntelligence } from "../siem/features/rule-intelligence.js";
import { buildProcessGraph, buildProcessSearchPredicate, findSourceProcessNodeId } from "../siem/process/graph.js";
import {
  deduplicateProcessEvents,
  expansionRanges,
  fetchProcessPages,
  mergeLoadedRanges,
  runProcessRangeQueries,
  seedProcessRange,
} from "../siem/process/progressive.js";
import { createSiemBackgroundFetch } from "./siem-transport.js";
import { domSettingsFingerprint, settingsImpact } from "./settings-runtime.js";
import { ERROR_CODES, normalizeError } from "../shared/errors.js";

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
      new EventFieldActions(settings),
      new FieldAliasesFeature(settings.fieldAliases),
      new EdrUiFeature(settings.features.disableEdrIntegration),
      new IocDescriptionFeature(client, settings, logger),
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
        case "siem:process":
          if (!settings.features.processTree) return { ok: false, error: "Process graph is disabled", kind: "feature-unavailable" };
          return await buildProcessContext(client, event, settings);
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

async function buildProcessContext(client, event, settings) {
  const host = event["event_src.host"];
  if (!host) return { ok: false, kind: "feature-unavailable", error: "Current event has no event_src.host" };
  const where = buildProcessSearchPredicate(host);
  const range = seedProcessRange(event.time, settings.process.seedWindowSeconds);
  const select = await processFields(client);
  const request = (requestScope) => fetchProcessPages(client, {
    where, select, ...range, scope: requestScope,
  }, { pageSize: settings.process.pageSize, maxEvents: settings.process.maxNodes });
  let result;
  try {
    result = await request(processScope(settings));
  } catch (error) {
    if (settings.searchScope.mode === "default" || !["http", "unsupported", "invalid-response"].includes(error.kind)) throw error;
    result = await request({});
  }
  const events = result.events;
  const graph = buildProcessGraph(events, settings.process);
  return {
    ok: true,
    graph,
    origin: client.origin,
    sourceEvent: event,
    sourceUuid: event.uuid ?? null,
    sourceNodeId: findSourceProcessNodeId(graph, event),
    queryMetadata: {
      where,
      timeFrom: range.timeFrom,
      timeTo: range.timeTo,
      loadedRanges: [{ from: range.timeFrom, to: range.timeTo }],
      maxNodes: settings.process.maxNodes,
      pageSize: settings.process.pageSize,
      pages: result.pages,
      pendingRanges: result.limitReached ? [{ direction: "seed", ...range, offset: result.nextOffset }] : [],
      partial: true,
      limitReached: result.limitReached || graph.truncated,
      searchScope: settings.searchScope.mode,
    },
  };
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

async function expandProcessContext(client, currentEvent, settings, message, signal) {
  const sourceEvent = message.sourceEvent && typeof message.sourceEvent === "object" ? message.sourceEvent : currentEvent;
  const host = sourceEvent["event_src.host"];
  if (!host) return { ok: false, kind: "feature-unavailable", error: "Source event has no event_src.host" };
  const existing = deduplicateProcessEvents(message.existingEvents);
  const nodeLimit = Math.min(10_000, Math.max(settings.process.maxNodes, Number(message.nodeLimit) || settings.process.maxNodes));
  const previousPending = Array.isArray(message.queryMetadata?.pendingRanges) ? message.queryMetadata.pendingRanges : [];
  const requestedRanges = message.resumeLimit && previousPending.length
    ? previousPending.map(({ direction, timeFrom, timeTo, offset }) => ({ direction, timeFrom, timeTo, offset }))
    : expansionRanges(message.queryMetadata, message.direction, Number(message.stepSeconds) || settings.process.expansionStepSeconds)
      .map((range) => ({ ...range, direction: message.direction, offset: 0 }));
  const remaining = Math.max(0, nodeLimit - existing.length);
  const ranges = remaining ? requestedRanges : [];
  let results = [];
  if (remaining) {
    const query = { where: buildProcessSearchPredicate(host), select: await processFields(client), scope: processScope(settings) };
    const request = (requestQuery) => runProcessRangeQueries(client, ranges, requestQuery, {
      concurrency: settings.process.queryConcurrency,
      pageSize: settings.process.pageSize,
      maxEvents: Math.max(1, Math.ceil(remaining / ranges.length)),
      signal,
    });
    try {
      results = await request(query);
    } catch (error) {
      if (settings.searchScope.mode === "default" || !["http", "unsupported", "invalid-response"].includes(error.kind)) throw error;
      results = await request({ ...query, scope: {} });
    }
  }
  const incoming = results.flatMap((result) => result.events);
  const events = deduplicateProcessEvents(existing, incoming).slice(0, nodeLimit);
  const graph = buildProcessGraph(events, { ...settings.process, maxNodes: nodeLimit });
  const loadedRanges = mergeLoadedRanges(message.queryMetadata?.loadedRanges, ranges);
  const nextPending = results.flatMap((result, index) => result.limitReached ? [{
    direction: ranges[index].direction,
    timeFrom: ranges[index].timeFrom,
    timeTo: ranges[index].timeTo,
    offset: result.nextOffset,
  }] : []);
  const pendingByRange = new Map((message.resumeLimit ? nextPending : [...previousPending, ...nextPending]).map((range) => [
    `${range.timeFrom}\n${range.timeTo}`,
    range,
  ]));
  const pendingRanges = [...pendingByRange.values()];
  const timeFrom = loadedRanges[0]?.from ?? message.queryMetadata?.timeFrom;
  const timeTo = loadedRanges.at(-1)?.to ?? message.queryMetadata?.timeTo;
  const limitReached = events.length >= nodeLimit || pendingRanges.length > 0 || graph.truncated;
  return {
    ok: true,
    graph,
    origin: client.origin,
    sourceEvent,
    sourceUuid: sourceEvent.uuid ?? null,
    sourceNodeId: findSourceProcessNodeId(graph, sourceEvent),
    queryMetadata: {
      ...message.queryMetadata,
      where: buildProcessSearchPredicate(host),
      timeFrom,
      timeTo,
      loadedRanges,
      maxNodes: nodeLimit,
      pageSize: settings.process.pageSize,
      pages: Number(message.queryMetadata?.pages ?? 0) + results.reduce((total, result) => total + result.pages, 0),
      pendingRanges,
      partial: true,
      limitReached,
      lastDirection: message.direction,
      searchScope: settings.searchScope.mode,
    },
  };
}

initialize().catch((error) => console.warn(`[ApePatrol] initialization failed: ${error.message}`));
