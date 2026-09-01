const first = (event, names) => names.map((name) => event?.[name]).find((value) => value !== undefined && value !== null && value !== "");

export function compileProcessTextFilter(value) {
  const query = String(value ?? "").trim();
  if (!query) return { test: () => true, error: null };
  if (query.startsWith("/") && query.lastIndexOf("/") > 0) {
    const closingSlash = query.lastIndexOf("/");
    const flags = query.slice(closingSlash + 1);
    if (/^[imsu]*$/.test(flags)) {
      try {
        const expression = new RegExp(query.slice(1, closingSlash), flags);
        return { test: (candidate) => expression.test(String(candidate ?? "")), error: null };
      } catch (error) {
        return { test: () => false, error: error.message };
      }
    }
  }
  const normalized = query.toLowerCase();
  return { test: (candidate) => String(candidate ?? "").toLowerCase().includes(normalized), error: null };
}

export function processEventText(event) {
  const values = [];
  const seen = new Set();
  const visit = (value) => {
    if (value === null || value === undefined) return;
    if (typeof value !== "object") {
      values.push(String(value));
      return;
    }
    if (seen.has(value)) return;
    seen.add(value);
    for (const nested of Array.isArray(value) ? value : Object.values(value)) visit(nested);
  };
  visit(event);
  return values.join(" ");
}

export function processFilterError(filters = {}) {
  for (const key of ["name", "path", "account", "pid", "host", "eventType", "eventText"]) {
    const compiled = compileProcessTextFilter(filters[key]);
    if (compiled.error) return { field: key, message: compiled.error };
  }
  return null;
}

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
  const matchers = Object.fromEntries(["name", "path", "account", "pid", "host", "eventType", "eventText"]
    .map((key) => [key, compileProcessTextFilter(filters[key]).test]));
  return new Set(nodes.filter((node) => {
    if (relationIds && !relationIds.has(node.id)) return false;
    if (filters.hideIsolated && node.connectionCount === 0) return false;
    if (node.time < timeFrom || node.time > timeTo) return false;
    const event = node.event;
    return matchers.name(first(event, ["object.process.name", "subject.process.name", "object.name"]))
      && matchers.path(first(event, ["object.process.path", "subject.process.path"]))
      && matchers.account(first(event, ["subject.account.name", "object.account.name"]))
      && matchers.pid(first(event, ["object.process.id", "subject.process.id", "object.id"]))
      && matchers.host(event?.["event_src.host"])
      && matchers.eventType(first(event, ["msgid", "event_src.title", "event_src.category"]))
      && matchers.eventText(node.eventText ?? processEventText(event));
  }).map((node) => node.id));
}
