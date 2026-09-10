import { describeEvent } from "@isaiandco/ape-share-core/events/describe";
import { createInvestigationGraph } from "@isaiandco/ape-share-core/investigation/graph";
import { andPredicates, buildEqualityPredicate, orPredicates } from "./pdql/builder.js";
import { parseSiemTime } from "./time.js";

const ENTITY_SPECS = Object.freeze([
  { key: "host", type: "host", label: "Хост", fields: ["event_src.host", "src.host", "dst.host", "subject.host", "object.host"] },
  { key: "account", type: "account", label: "Учётная запись", fields: ["subject.account.name", "object.account.name", "src.account.name", "dst.account.name"] },
  { key: "account-id", type: "account", label: "SID / ID учётной записи", fields: ["subject.account.id", "object.account.id", "src.account.id", "dst.account.id"] },
  { key: "ip", type: "ip", label: "IP-адрес", fields: ["src.ip", "dst.ip", "event_src.ip", "subject.ip", "object.ip"] },
  { key: "process-guid", type: "process", label: "GUID процесса", fields: ["subject.process.guid", "object.process.guid", "subject.process.parent.guid", "object.process.parent.guid"] },
  { key: "process-path", type: "process", label: "Процесс", fields: ["subject.process.path", "object.process.path", "subject.process.name", "object.process.name"] },
  { key: "file", type: "file", label: "Файл", fields: ["subject.file.path", "object.file.path", "file.path", "object.path"] },
  { key: "hash", type: "hash", label: "Хэш", fields: ["subject.hash", "object.hash", "file.hash", "subject.file.hash", "object.file.hash"] },
  { key: "domain", type: "domain", label: "Домен", fields: ["src.domain", "dst.domain", "subject.domain", "object.domain", "dns.query"] },
  { key: "session", type: "session", label: "Сессия", fields: ["subject.session.id", "object.session.id", "session.id", "logon.id"] },
  { key: "incident", type: "incident", label: "Инцидент", fields: ["incident_id"] },
]);

export const INVESTIGATION_EVENT_FIELDS = Object.freeze([
  "uuid", "time", "msgid", "correlation_name", "correlation_type",
  "normalization_rule_name", "normalization.name", "normalizer.name", "normalization_rule",
  "event_src.title", "event_src.category",
  "description", "event_description", "reason", "action",
  "object.process.cmdline", "subject.process.cmdline", "src.port", "dst.port",
  ...new Set(ENTITY_SPECS.flatMap((spec) => spec.fields)),
]);

function valuesOf(value) {
  if (Array.isArray(value)) return value.flatMap(valuesOf);
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "object") return [];
  return [String(value).trim()].filter(Boolean);
}


function eventIdentity(item, index) {
  return String(item.snapshot?.uuid ?? item.sourceEventUuid ?? item.value ?? index);
}

export function investigationEventTime(item) {
  return parseSiemTime(item?.snapshot?.time)?.valueOf() ?? null;
}

export function sortWorkspaceItems(items, order = "time-asc") {
  const indexed = (Array.isArray(items) ? items : []).map((item, index) => ({ item, index }));
  if (order === "added") return indexed;
  return indexed.sort((first, second) => {
    const firstTime = investigationEventTime(first.item);
    const secondTime = investigationEventTime(second.item);
    if (first.item.type === "event" && second.item.type === "event" && firstTime !== secondTime) {
      if (firstTime === null) return 1;
      if (secondTime === null) return -1;
      return order === "time-desc" ? secondTime - firstTime : firstTime - secondTime;
    }
    if (first.item.type === "event" && second.item.type !== "event") return -1;
    if (second.item.type === "event" && first.item.type !== "event") return 1;
    return (first.item.createdAt ?? 0) - (second.item.createdAt ?? 0) || first.index - second.index;
  });
}

function firstValue(event, fields) {
  for (const field of fields) {
    const value = valuesOf(event?.[field])[0];
    if (value) return value;
  }
  return null;
}

export function describeInvestigationEvent(event = {}) {
  const msgid = firstValue(event, ["msgid"]);
  const action = firstValue(event, ["action"]);
  const host = firstValue(event, ["event_src.host", "src.host", "dst.host"]);
  const account = firstValue(event, ["object.account.name", "dst.account.name", "subject.account.name", "src.account.name"]);
  const process = firstValue(event, ["object.process.name", "object.process.path", "subject.process.name", "subject.process.path"]);
  const commandLine = firstValue(event, ["object.process.cmdline", "subject.process.cmdline"]);
  const sourceIp = firstValue(event, ["src.ip"]);
  const destinationIp = firstValue(event, ["dst.ip"]);
  const file = firstValue(event, ["object.file.path", "subject.file.path", "file.path", "object.path"]);
  const correlationRule = firstValue(event, ["correlation_name"]);
  const normalizationRule = firstValue(event, ["normalization_rule_name", "normalization.name", "normalizer.name", "normalization_rule"]);
  const sourceTitle = firstValue(event, ["event_src.title"]);
  const originalDescription = firstValue(event, ["description", "event_description", "reason"]);
  return describeEvent({ msgid, action, host, account, process, commandLine, sourceIp, destinationIp, file, correlationRule, normalizationRule, sourceTitle, originalDescription, eventName: firstValue(event, ["event_name", "name"]) });
}

function extractedEntities(event = {}) {
  const result = [];
  for (const spec of ENTITY_SPECS) {
    for (const field of spec.fields) {
      for (const value of valuesOf(event[field])) result.push({ spec, field, value });
    }
  }
  return result;
}

function standaloneEntity(item) {
  if (item.type === "process") return extractedEntities(item.snapshot).find((entity) => entity.spec.type === "process") ?? null;
  if (!["host", "account", "incident", "ioc"].includes(item.type)) return null;
  let type = item.type;
  let value = item.value;
  if (type === "ioc") {
    const separator = value.indexOf(":");
    if (separator < 1) return null;
    type = value.slice(0, separator) === "domain" ? "domain" : value.slice(0, separator);
    value = value.slice(separator + 1);
  }
  const spec = ENTITY_SPECS.find((candidate) => candidate.type === type && !candidate.key.endsWith("-id"));
  return spec && value ? { spec, value: String(value), field: item.snapshot?.field ?? null } : null;
}

export const buildInvestigationGraph = createInvestigationGraph({ eventIdentity, eventRef: item => item.snapshot?.uuid,
  investigationEventTime, describeInvestigationEvent, extractedEntities, standaloneEntity });

export function buildEntitySearchPredicate(nodes, mode = "all") {
  const predicates = (Array.isArray(nodes) ? nodes : []).filter((node) => node?.kind === "entity" && node.queryValue && node.queryFields?.length)
    .map((node) => orPredicates(node.queryFields.map((field) => buildEqualityPredicate(field, node.queryValue))));
  if (!predicates.length) return "";
  return mode === "any" ? orPredicates(predicates) : andPredicates(predicates);
}
