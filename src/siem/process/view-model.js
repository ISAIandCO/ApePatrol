const first = (event, names) => names.map((name) => event?.[name]).find((value) => value !== undefined && value !== null && value !== "");

export const PROCESS_DETAIL_FIELDS = Object.freeze([
  ["Время", ["time"]],
  ["Хост", ["event_src.host"]],
  ["Процесс", ["object.process.name", "subject.process.name", "object.name"]],
  ["Путь", ["object.process.path", "subject.process.path"]],
  ["Командная строка", ["object.process.cmdline", "subject.process.cmdline"]],
  ["PID", ["object.process.id", "subject.process.id", "object.id"]],
  ["GUID", ["object.process.guid", "subject.process.guid"]],
  ["Родительский PID", ["object.process.parent.id", "subject.process.parent.id"]],
  ["Родительский GUID", ["object.process.parent.guid", "subject.process.parent.guid"]],
  ["Учётная запись", ["subject.account.name", "object.account.name"]],
  ["Событие", ["msgid"]],
  ["UUID", ["uuid"]],
]);

export function processNodeRadius(connectionCount) {
  const degree = Math.max(0, Number(connectionCount) || 0);
  return Math.min(34, 10 + Math.sqrt(degree) * 6);
}

export function processNodeLabel(event) {
  const process = first(event, ["object.process.name", "subject.process.name", "object.process.path", "subject.process.path", "object.name"]);
  const commandLine = first(event, ["object.process.cmdline", "subject.process.cmdline"]);
  const pid = first(event, ["object.process.id", "subject.process.id", "object.id"]);
  return String(process ?? commandLine ?? (pid === undefined ? "Неизвестный процесс" : `PID ${pid}`));
}

export function processNodeDetails(event) {
  return PROCESS_DETAIL_FIELDS.map(([label, fields]) => ({ label, value: first(event, fields) }))
    .filter((item) => item.value !== undefined)
    .map((item) => ({ ...item, value: String(item.value) }));
}

export function buildProcessGraphView(graph, sourceNodeId = null) {
  if (!Array.isArray(graph?.nodes)) return { nodes: [], edges: [] };
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const edges = graph.nodes
    .filter((node) => node.parentId && nodeIds.has(node.parentId))
    .map((node) => ({ sourceId: node.parentId, targetId: node.id }));
  const degrees = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of edges) {
    degrees.set(edge.sourceId, (degrees.get(edge.sourceId) ?? 0) + 1);
    degrees.set(edge.targetId, (degrees.get(edge.targetId) ?? 0) + 1);
  }
  const nodes = graph.nodes.map((node) => {
    const connectionCount = degrees.get(node.id) ?? 0;
    const details = processNodeDetails(node.event);
    return {
      id: node.id,
      parentId: node.parentId,
      depth: node.depth ?? 0,
      time: node.time ?? 0,
      event: node.event,
      connectionCount,
      radius: processNodeRadius(connectionCount),
      selected: node.id === sourceNodeId,
      label: processNodeLabel(node.event),
      searchText: details.map((item) => item.value).join(" ").toLowerCase(),
      details,
    };
  });
  return { nodes, edges };
}
