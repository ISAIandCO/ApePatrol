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
  const pid = first(event, ["object.process.id", "object.id"]);
  if (pid !== undefined) return { id: `${host}|pid:${pid}|${asTime(event)}|${event.uuid ?? ""}`, kind: "pid", value: String(pid) };
  return { id: `${host}|event:${event.uuid ?? asTime(event)}`, kind: "event", value: String(event.uuid ?? "") };
}

function parentReference(event) {
  const guid = event["object.process.parent.guid"];
  if (guid) return { kind: "guid", value: String(guid) };
  const pid = event["object.process.parent.id"];
  return pid === undefined || pid === null || pid === "" ? null : { kind: "pid", value: String(pid) };
}

function wouldCycle(nodes, childId, parentId) {
  let current = parentId;
  const seen = new Set([childId]);
  while (current) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = nodes.get(current)?.parentId ?? null;
  }
  return false;
}

export function buildProcessGraph(events, { maxNodes = 1000, maxDepth = 64 } = {}) {
  if (!Array.isArray(events) || events.length === 0) return { nodes: [], roots: [], truncated: false };
  const sorted = [...events].sort((a, b) => asTime(a) - asTime(b));
  const nodes = new Map();
  for (const event of sorted.slice(0, maxNodes)) {
    const identity = processIdentity(event);
    if (identity.kind === "guid" && nodes.has(identity.id)) continue;
    nodes.set(identity.id, {
      id: identity.id,
      identity,
      parentRef: parentReference(event),
      parentId: null,
      children: [],
      event,
      time: asTime(event),
      depth: 0,
    });
  }
  const list = [...nodes.values()];
  for (const node of list) {
    if (!node.parentRef) continue;
    const candidates = list.filter((candidate) => {
      if (candidate.id === node.id || candidate.identity.kind !== node.parentRef.kind || candidate.identity.value !== node.parentRef.value) return false;
      return candidate.time <= node.time;
    });
    const parent = candidates.sort((a, b) => b.time - a.time)[0];
    if (parent && !wouldCycle(nodes, node.id, parent.id)) node.parentId = parent.id;
  }
  const depthOf = (node, seen = new Set()) => {
    if (!node.parentId || seen.has(node.id)) return 0;
    seen.add(node.id);
    const parent = nodes.get(node.parentId);
    return parent ? Math.min(maxDepth, depthOf(parent, seen) + 1) : 0;
  };
  for (const node of list) {
    node.depth = depthOf(node);
    if (node.depth >= maxDepth) node.parentId = null;
  }
  for (const node of list) if (node.parentId) nodes.get(node.parentId)?.children.push(node.id);
  return {
    nodes: list,
    roots: list.filter((node) => !node.parentId).map((node) => node.id),
    truncated: events.length > maxNodes,
  };
}

export async function boundedMap(items, concurrency, mapper, signal) {
  const results = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      if (signal?.aborted) throw signal.reason;
      const current = index++;
      results[current] = await mapper(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length || 1)) }, worker));
  return results;
}
