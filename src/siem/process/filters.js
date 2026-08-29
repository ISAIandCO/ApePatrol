const first = (event, names) => names.map((name) => event?.[name]).find((value) => value !== undefined && value !== null && value !== "");
const contains = (value, query) => !query || String(value ?? "").toLowerCase().includes(query.toLowerCase());

function relatedIds(nodes, selectedId, mode) {
  if (mode === "all" || !selectedId) return null;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const values = children.get(node.parentId) ?? [];
    values.push(node.id);
    children.set(node.parentId, values);
  }
  const result = new Set([selectedId]);
  if (["ancestors", "direct"].includes(mode)) {
    let parentId = nodeMap.get(selectedId)?.parentId;
    while (parentId) {
      result.add(parentId);
      if (mode === "direct") break;
      parentId = nodeMap.get(parentId)?.parentId;
    }
  }
  if (["descendants", "direct"].includes(mode)) {
    const queue = [...(children.get(selectedId) ?? [])];
    while (queue.length) {
      const childId = queue.shift();
      if (result.has(childId)) continue;
      result.add(childId);
      if (mode !== "direct") queue.push(...(children.get(childId) ?? []));
    }
  }
  return result;
}

export function filterProcessNodes(nodes, filters = {}, selectedId = null) {
  const relationIds = relatedIds(nodes, selectedId, filters.relations ?? "all");
  const timeFrom = Number.isFinite(filters.timeFrom) ? filters.timeFrom : -Infinity;
  const timeTo = Number.isFinite(filters.timeTo) ? filters.timeTo : Infinity;
  return new Set(nodes.filter((node) => {
    if (relationIds && !relationIds.has(node.id)) return false;
    if (filters.hideIsolated && node.connectionCount === 0) return false;
    if (node.time < timeFrom || node.time > timeTo) return false;
    const event = node.event;
    return contains(first(event, ["object.process.name", "subject.process.name", "object.name"]), filters.name)
      && contains(first(event, ["object.process.path", "subject.process.path"]), filters.path)
      && contains(first(event, ["subject.account.name", "object.account.name"]), filters.account)
      && contains(first(event, ["object.process.id", "subject.process.id", "object.id"]), filters.pid)
      && contains(event?.["event_src.host"], filters.host)
      && contains(first(event, ["msgid", "event_src.title", "event_src.category"]), filters.eventType);
  }).map((node) => node.id));
}
