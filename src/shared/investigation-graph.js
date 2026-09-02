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
  "uuid", "time", "msgid", "correlation_name", "correlation_type", "event_src.title", "event_src.category",
  "description", "event_description", "reason", "action",
  ...new Set(ENTITY_SPECS.flatMap((spec) => spec.fields)),
]);

function valuesOf(value) {
  if (Array.isArray(value)) return value.flatMap(valuesOf);
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "object") return [];
  return [String(value).trim()].filter(Boolean);
}

function canonical(value) { return String(value).normalize("NFKC").toLocaleLowerCase(); }

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
  const title = firstValue(event, ["correlation_name", "event_src.title", "event_name", "name"])
    ?? (event.msgid ? `Событие ${event.msgid}` : "Событие SIEM");
  const description = firstValue(event, ["description", "event_description", "reason", "action"]);
  const details = [
    event.msgid ? `ID ${event.msgid}` : null,
    firstValue(event, ["event_src.host"]) ? `хост ${firstValue(event, ["event_src.host"])}` : null,
    firstValue(event, ["subject.account.name", "object.account.name"]) ? `учётная запись ${firstValue(event, ["subject.account.name", "object.account.name"])}` : null,
    firstValue(event, ["object.process.path", "subject.process.path", "object.process.name", "subject.process.name"]),
  ].filter(Boolean);
  return { title: String(title), description: description ? String(description) : details.join(" · ") || "Описание отсутствует в событии" };
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

export function buildInvestigationGraph(items, { sharedOnly = false } = {}) {
  const nodes = new Map();
  const edges = new Map();
  const eventsByUuid = new Map();
  const eventItems = (Array.isArray(items) ? items : []).map((item, index) => ({ item, index })).filter(({ item }) => item.type === "event");

  for (const { item, index } of eventItems) {
    const identity = eventIdentity(item, index);
    const id = `event:${identity}`;
    const view = describeInvestigationEvent(item.snapshot);
    nodes.set(id, { id, kind: "event", label: view.title, description: view.description, itemIndex: index, event: item.snapshot, time: investigationEventTime(item) });
    if (item.snapshot?.uuid) eventsByUuid.set(String(item.snapshot.uuid), id);
    for (const entity of extractedEntities(item.snapshot)) {
      const entityId = `entity:${entity.spec.key}:${canonical(entity.value)}`;
      if (!nodes.has(entityId)) nodes.set(entityId, {
        id: entityId, kind: "entity", entityType: entity.spec.type, entityKey: entity.spec.key,
        typeLabel: entity.spec.label, label: entity.value, queryFields: entity.spec.fields, queryValue: entity.value,
      });
      const edgeId = `${id}|${entityId}`;
      if (!edges.has(edgeId)) edges.set(edgeId, { sourceId: id, targetId: entityId, fields: [] });
      const edge = edges.get(edgeId);
      if (!edge.fields.includes(entity.field)) edge.fields.push(entity.field);
    }
  }

  for (const [index, item] of (Array.isArray(items) ? items : []).entries()) {
    if (item.type === "event") continue;
    const entity = standaloneEntity(item);
    if (!entity) continue;
    const entityId = `entity:${entity.spec.key}:${canonical(entity.value)}`;
    if (!nodes.has(entityId)) nodes.set(entityId, {
      id: entityId, kind: "entity", entityType: entity.spec.type, entityKey: entity.spec.key,
      typeLabel: entity.spec.label, label: entity.value, queryFields: entity.spec.fields, queryValue: entity.value, itemIndex: index,
    });
    const sourceId = item.sourceEventUuid && eventsByUuid.get(String(item.sourceEventUuid));
    if (sourceId) edges.set(`${sourceId}|${entityId}`, { sourceId, targetId: entityId, fields: entity.field ? [entity.field] : [] });
  }

  const degrees = new Map();
  for (const edge of edges.values()) {
    degrees.set(edge.sourceId, (degrees.get(edge.sourceId) ?? 0) + 1);
    degrees.set(edge.targetId, (degrees.get(edge.targetId) ?? 0) + 1);
  }
  const visibleNodes = [...nodes.values()].filter((node) => !sharedOnly || node.kind === "event" || (degrees.get(node.id) ?? 0) > 1);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = [...edges.values()].filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId));
  const visibleDegrees = new Map();
  for (const edge of visibleEdges) {
    visibleDegrees.set(edge.sourceId, (visibleDegrees.get(edge.sourceId) ?? 0) + 1);
    visibleDegrees.set(edge.targetId, (visibleDegrees.get(edge.targetId) ?? 0) + 1);
  }
  for (const node of visibleNodes) node.connectionCount = visibleDegrees.get(node.id) ?? 0;
  return { nodes: visibleNodes, edges: visibleEdges };
}

export function buildEntitySearchPredicate(nodes, mode = "all") {
  const predicates = (Array.isArray(nodes) ? nodes : []).filter((node) => node?.kind === "entity" && node.queryValue && node.queryFields?.length)
    .map((node) => orPredicates(node.queryFields.map((field) => buildEqualityPredicate(field, node.queryValue))));
  if (!predicates.length) return "";
  return mode === "any" ? orPredicates(predicates) : andPredicates(predicates);
}
