import { andPredicates, buildEqualityPredicate, orPredicates } from "../../shared/pdql/builder.js";
import { parseSiemTime } from "../../shared/time.js";

const first = (event, names) => names.map((name) => event[name]).find((value) => value !== undefined && value !== null && value !== "");
const asTime = (event) => parseSiemTime(event.time)?.valueOf() ?? 0;

export function buildProcessSearchPredicate(host) {
  return andPredicates(
    buildEqualityPredicate("event_src.host", host),
    orPredicates("msgid in [1, 4688]", "msgid = 'execve'"),
    "correlation_name = null",
  );
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

function referenceKey(host, reference) {
  return `${host}|${reference.kind}:${reference.value}`;
}

function addToIndex(index, key, node) {
  const values = index.get(key) ?? [];
  values.push(node);
  index.set(key, values);
}

function latestPrior(candidates, node, minimumTime = -Infinity) {
  if (!candidates?.length) return null;
  let low = 0;
  let high = candidates.length - 1;
  let match = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = candidates[middle];
    const prior = candidate.time < node.time || (candidate.time === node.time && candidate.order < node.order);
    if (prior) {
      match = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  const candidate = match >= 0 ? candidates[match] : null;
  return candidate && candidate.time >= minimumTime ? candidate : null;
}

export function buildProcessGraph(events, { maxNodes = 1000, maxDepth = 64, pidParentWindowMs = 24 * 60 * 60_000 } = {}) {
  if (!Array.isArray(events) || events.length === 0) return { nodes: [], roots: [], truncated: false };
  const sorted = [...events].sort((a, b) => asTime(a) - asTime(b));
  const nodes = new Map();
  let order = 0;
  for (const event of sorted.slice(0, maxNodes)) {
    const identity = processIdentity(event);
    if (identity.kind === "guid" && nodes.has(identity.id)) continue;
    const host = String(event["event_src.host"] ?? "unknown");
    nodes.set(identity.id, {
      id: identity.id,
      identity,
      host,
      references: processReferences(event),
      parentRefs: parentReferences(event),
      parentId: null,
      children: [],
      event,
      time: asTime(event),
      depth: 0,
      order: order++,
    });
  }
  const list = [...nodes.values()];
  const referenceIndex = new Map();
  for (const node of list) {
    for (const reference of node.references) addToIndex(referenceIndex, referenceKey(node.host, reference), node);
  }
  let parentIndexLookups = 0;
  for (const node of list) {
    if (!node.parentRefs.length) continue;
    let parent = null;
    for (const reference of [...node.parentRefs].sort((a, b) => Number(a.kind === "pid") - Number(b.kind === "pid"))) {
      parentIndexLookups += 1;
      const minimumTime = reference.kind === "pid" ? node.time - pidParentWindowMs : -Infinity;
      parent = latestPrior(referenceIndex.get(referenceKey(node.host, reference)), node, minimumTime);
      if (parent) break;
    }
    if (parent) node.parentId = parent.id;
  }
  for (const node of list) {
    const parent = nodes.get(node.parentId);
    const depth = parent ? parent.depth + 1 : 0;
    if (depth >= maxDepth) {
      node.parentId = null;
      node.depth = 0;
    } else {
      node.depth = depth;
    }
  }
  for (const node of list) if (node.parentId) nodes.get(node.parentId)?.children.push(node.id);
  return {
    nodes: list,
    roots: list.filter((node) => !node.parentId).map((node) => node.id),
    truncated: events.length > maxNodes,
    diagnostics: {
      inputEvents: events.length,
      indexedNodes: list.length,
      referenceIndexKeys: referenceIndex.size,
      parentIndexLookups,
    },
  };
}

function closestProcessNode(nodes, reference, sourceTime, sourceHost) {
  const candidates = nodes
    .filter((node) => node.host === sourceHost && node.references.some((item) => item.kind === reference.kind && item.value === reference.value))
    .sort((a, b) => a.time - b.time || a.order - b.order);
  if (!candidates.length) return null;
  const virtualNode = { time: sourceTime, order: Number.MAX_SAFE_INTEGER };
  return latestPrior(candidates, virtualNode) ?? candidates[0];
}

export function findSourceProcessNodeId(graph, sourceEvent) {
  if (!Array.isArray(graph?.nodes) || !sourceEvent || typeof sourceEvent !== "object") return null;
  const sourceUuid = String(sourceEvent.uuid ?? "");
  const exact = sourceUuid && graph.nodes.find((node) => String(node.event?.uuid ?? "") === sourceUuid);
  if (exact) return exact.id;
  const references = processReferences(sourceEvent);
  const sourceTime = asTime(sourceEvent);
  const sourceHost = String(sourceEvent["event_src.host"] ?? "unknown");
  for (const kind of ["guid", "pid"]) {
    const reference = references.find((item) => item.kind === kind);
    const match = reference && closestProcessNode(graph.nodes, reference, sourceTime, sourceHost);
    if (match) return match.id;
  }
  return null;
}

export function orderProcessTree(graph) {
  if (!Array.isArray(graph?.nodes)) return [];
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const ordered = [];
  const visited = new Set();
  const visit = (node) => {
    if (!node || visited.has(node.id)) return;
    visited.add(node.id);
    ordered.push(node);
    const children = node.children.map((id) => nodes.get(id)).filter(Boolean).sort((a, b) => a.time - b.time);
    children.forEach(visit);
  };
  graph.roots.map((id) => nodes.get(id)).filter(Boolean).sort((a, b) => a.time - b.time).forEach(visit);
  graph.nodes.filter((node) => !visited.has(node.id)).sort((a, b) => a.time - b.time).forEach(visit);
  return ordered;
}
