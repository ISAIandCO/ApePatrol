import { buildProcessGraph as build, findSourceProcessNodeId as find } from "@isaiandco/ape-share-core/graph/process-model";
export { selectProcessNeighborhood, selectDirectProcessRelatives, orderProcessTree } from "@isaiandco/ape-share-core/graph/process-model";
import { andPredicates, buildEqualityPredicate, buildInPredicate, orPredicates } from "../../shared/pdql/builder.js";
import { parseSiemTime } from "../../shared/time.js";

const first = (event, names) => names.map((name) => event?.[name]).find((value) => value !== undefined && value !== null && value !== "");
const asTime = (event) => parseSiemTime(event?.time)?.valueOf() ?? 0;

export function buildProcessSearchPredicate(host) {
  return andPredicates(
    buildEqualityPredicate("event_src.host", host),
    orPredicates("msgid in [1, 4688]", "msgid = 'execve'"),
    "correlation_name = null",
  );
}

function processIdValue(field, value) {
  const numeric = Number(value);
  return field.endsWith(".id") && Number.isSafeInteger(numeric) && String(numeric) === String(value) ? numeric : value;
}

export function buildProcessRelationPredicate(input, direction = "both") {
  if (!["parents", "children", "both", "siblings"].includes(direction)) throw new TypeError("Unknown process relation direction");
  const events = (Array.isArray(input) ? input : [input]).filter((event) => event && typeof event === "object");
  const host = events[0]?.["event_src.host"];
  if (!host) return "";
  const valuesByField = new Map();
  const add = (field, value) => {
    if (value === undefined || value === null || value === "") return;
    const values = valuesByField.get(field) ?? new Map();
    const normalized = processIdValue(field, value);
    values.set(`${typeof normalized}:${normalized}`, normalized);
    valuesByField.set(field, values);
  };
  for (const event of events.filter((candidate) => String(candidate["event_src.host"] ?? "") === String(host))) {
    for (const [processField, parentField] of [
      ["object.process.guid", "object.process.parent.guid"],
      ["subject.process.guid", "subject.process.parent.guid"],
      ["object.process.id", "object.process.parent.id"],
      ["subject.process.id", "subject.process.parent.id"],
      ["object.id", "object.process.parent.id"],
    ]) {
      if (direction === "siblings") { add(parentField, event[parentField]); continue; }
      const processValue = event[processField];
      add(processField, processValue);
      if (["children", "both"].includes(direction)) add(parentField, processValue);
      if (["parents", "both"].includes(direction) && processField !== "object.id") add(processField, event[parentField]);
    }
  }
  const predicates = [...valuesByField].map(([field, values]) => {
    const list = [...values.values()];
    return list.length === 1 ? buildEqualityPredicate(field, list[0]) : buildInPredicate(field, list);
  });
  const broad = buildProcessSearchPredicate(host);
  return predicates.length ? andPredicates(broad, orPredicates(predicates)) : broad;
}

export function buildProcessFocusPredicate(event) {
  return buildProcessRelationPredicate(event, "both");
}

function processIdentity(event) {
  const host = String(event["event_src.host"] ?? "unknown");
  const guid = first(event, ["object.process.guid", "subject.process.guid"]);
  if (guid) return { id: `${host}|guid:${guid}`, kind: "guid", value: String(guid) };
  const pid = first(event, ["object.process.id", "object.id", "subject.process.id"]);
  if (pid !== undefined) return { id: `${host}|pid:${pid}|${asTime(event)}|${event.uuid ?? ""}`, kind: "pid", value: String(pid) };
  return { id: `${host}|event:${event.uuid ?? asTime(event)}`, kind: "event", value: String(event.uuid ?? "") };
}

function processReferences(event) {
  const references = [];
  const guid = first(event, ["object.process.guid", "subject.process.guid"]);
  const pid = first(event, ["object.process.id", "object.id", "subject.process.id"]);
  if (guid) references.push({ kind: "guid", value: String(guid) });
  if (pid !== undefined) references.push({ kind: "pid", value: String(pid) });
  return references;
}

function parentReferences(event) {
  const references = [];
  const guid = first(event, ["object.process.parent.guid", "subject.process.parent.guid"]);
  const pid = first(event, ["object.process.parent.id", "subject.process.parent.id"]);
  if (guid) references.push({ kind: "guid", value: String(guid) });
  if (pid !== undefined) references.push({ kind: "pid", value: String(pid) });

  // Some collectors expose the creator only as subject.process.* on a process
  // creation event. Treat it as the parent when object.process.* is distinct.
  const objectGuid = event["object.process.guid"];
  const subjectGuid = event["subject.process.guid"];
  const objectPid = event["object.process.id"] ?? event["object.id"];
  const subjectPid = event["subject.process.id"];
  if (!guid && subjectGuid && subjectGuid !== objectGuid) references.push({ kind: "guid", value: String(subjectGuid) });
  if (pid === undefined && subjectPid !== undefined && String(subjectPid) !== String(objectPid ?? "")) references.push({ kind: "pid", value: String(subjectPid) });
  return references;
}

export function normalizeProcessEvent(event) {
  if (!event || typeof event !== "object") return null;
  return { raw: event, recordId: String(event.uuid ?? ""), host: String(event["event_src.host"] ?? "unknown"),
    time: asTime(event), identity: processIdentity(event), references: processReferences(event), parentRefs: parentReferences(event) };
}

export function buildProcessGraph(events, options = {}) {
  return build(Array.isArray(events) ? events.map(normalizeProcessEvent).filter(Boolean) : [], {
    ...options, sourceEvent: normalizeProcessEvent(options.sourceEvent),
  });
}

export function findSourceProcessNodeId(graph, event) { return find({ ...graph, nodes: graph?.nodes?.map(node => ({ ...node, fact: node.fact ?? normalizeProcessEvent(node.event) })) }, normalizeProcessEvent(event)); }
