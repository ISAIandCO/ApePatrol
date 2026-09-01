import { describe, expect, it } from "vitest";
import { buildProcessGraph, buildProcessSearchPredicate, findSourceProcessNodeId, orderProcessTree } from "../src/siem/process/graph.js";

const event = (overrides = {}) => ({ uuid: crypto.randomUUID(), time: "2026-01-01T00:00:00Z", msgid: "1", "event_src.host": "host", "object.process.id": "10", ...overrides });

describe("process graph", () => {
  it("uses numeric Windows message IDs and a separate Linux execve branch", () => {
    expect(buildProcessSearchPredicate("host'o")).toBe("(event_src.host = 'host\\'o') and ((msgid in [1, 4688]) or (msgid = 'execve')) and (correlation_name = null)");
  });
  it("normalizes epoch-second strings for graph ordering", () => {
    const graph = buildProcessGraph([event({ time: "1767225600", "object.process.guid": "A" })]);
    expect(graph.nodes[0].time).toBe(1_767_225_600_000);
  });
  it("handles an empty result", () => expect(buildProcessGraph([])).toEqual({ nodes: [], roots: [], truncated: false }));
  it("handles one node and a GUID parent tree", () => {
    expect(buildProcessGraph([event()]).nodes).toHaveLength(1);
    const parent = event({ uuid: "p", "object.process.guid": "P", "object.process.id": "1" });
    const child = event({ uuid: "c", time: "2026-01-01T00:00:01Z", "object.process.guid": "C", "object.process.parent.guid": "P" });
    const graph = buildProcessGraph([child, parent]);
    expect(graph.nodes.find((node) => node.event.uuid === "c").parentId).toContain("guid:P");
  });
  it("deduplicates a GUID", () => expect(buildProcessGraph([event({ "object.process.guid": "A" }), event({ "object.process.guid": "A" })]).nodes).toHaveLength(1));
  it("links a GUID-addressed child to a GUID parent by the parent's PID fallback", () => {
    const parent = event({ uuid: "parent", "object.process.id": "20", "object.process.guid": "P" });
    const child = event({ uuid: "child", time: "2026-01-01T00:00:01Z", "object.process.id": "30", "object.process.guid": "C", "object.process.parent.id": "20" });
    const graph = buildProcessGraph([child, parent]);
    expect(graph.nodes.find((node) => node.event.uuid === "child").parentId).toBe(graph.nodes.find((node) => node.event.uuid === "parent").id);
  });
  it("orders a tree as parent then descendants instead of grouping all equal depths", () => {
    const graph = buildProcessGraph([
      event({ uuid: "root-a", "object.process.id": "1" }),
      event({ uuid: "root-b", time: "2026-01-01T00:00:01Z", "object.process.id": "2" }),
      event({ uuid: "child-a", time: "2026-01-01T00:00:02Z", "object.process.id": "3", "object.process.parent.id": "1" }),
    ]);
    expect(orderProcessTree(graph).map((node) => node.event.uuid)).toEqual(["root-a", "child-a", "root-b"]);
  });
  it("breaks cycles", () => {
    const graph = buildProcessGraph([
      event({ uuid: "a", "object.process.guid": "A", "object.process.parent.guid": "B" }),
      event({ uuid: "b", "object.process.guid": "B", "object.process.parent.guid": "A" }),
    ]);
    expect(graph.roots.length).toBeGreaterThan(0);
  });
  it("protects against PID reuse by using the closest prior process", () => {
    const oldProcess = event({ uuid: "old", time: "2026-01-01T00:00:00Z", "object.process.id": "20" });
    const newProcess = event({ uuid: "new", time: "2026-01-01T01:00:00Z", "object.process.id": "20" });
    const child = event({ uuid: "child", time: "2026-01-01T01:00:01Z", "object.process.id": "30", "object.process.parent.id": "20" });
    const graph = buildProcessGraph([oldProcess, newProcess, child]);
    const parent = graph.nodes.find((node) => node.id === graph.nodes.find((node) => node.event.uuid === "child").parentId);
    expect(parent.event.uuid).toBe("new");
  });
  it("does not link a reused PID outside the parent time window", () => {
    const oldProcess = event({ uuid: "old", time: "2026-01-01T00:00:00Z", "object.process.id": "20" });
    const child = event({ uuid: "child", time: "2026-01-03T00:00:00Z", "object.process.id": "30", "object.process.parent.id": "20" });
    const graph = buildProcessGraph([oldProcess, child]);
    expect(graph.nodes.find((node) => node.event.uuid === "child").parentId).toBeNull();
  });
  it("never links equal PIDs across hosts", () => {
    const parent = event({ uuid: "parent", "event_src.host": "host-a", "object.process.id": "20" });
    const child = event({ uuid: "child", time: "2026-01-01T00:00:01Z", "event_src.host": "host-b", "object.process.id": "30", "object.process.parent.id": "20" });
    const graph = buildProcessGraph([parent, child]);
    expect(graph.nodes.find((node) => node.event.uuid === "child").parentId).toBeNull();
  });
  it("uses bounded indexed lookups for 10,000 process events", () => {
    const events = Array.from({ length: 10_000 }, (_, index) => event({
      uuid: `event-${index}`,
      time: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
      "object.process.guid": `process-${index}`,
      ...(index ? { "object.process.parent.guid": `process-${index - 1}` } : {}),
    }));
    const graph = buildProcessGraph(events, { maxNodes: 10_000, maxDepth: 10_001 });
    expect(graph.nodes).toHaveLength(10_000);
    expect(graph.diagnostics.parentIndexLookups).toBeLessThanOrEqual(20_000);
    expect(graph.nodes.filter((node) => node.parentId)).toHaveLength(9_999);
  });
  it("supports missing GUID and respects max nodes", () => expect(buildProcessGraph([event(), event({ uuid: "2" })], { maxNodes: 1 }).truncated).toBe(true));
  it("finds the originally selected process by GUID when its event UUID is not a process-start event", () => {
    const start = event({ uuid: "start", time: "2026-01-01T00:00:00Z", "object.process.guid": "PROCESS" });
    const selected = event({ uuid: "network-event", time: "2026-01-01T00:05:00Z", "object.process.guid": "PROCESS" });
    const graph = buildProcessGraph([start]);
    expect(findSourceProcessNodeId(graph, selected)).toBe(graph.nodes[0].id);
  });
  it("uses the closest prior PID instance when identifying the selected process", () => {
    const oldProcess = event({ uuid: "old", time: "2026-01-01T00:00:00Z", "object.process.id": "20" });
    const currentProcess = event({ uuid: "current", time: "2026-01-01T01:00:00Z", "object.process.id": "20" });
    const selected = event({ uuid: "activity", time: "2026-01-01T01:05:00Z", "object.process.id": "20" });
    const graph = buildProcessGraph([oldProcess, currentProcess]);
    expect(findSourceProcessNodeId(graph, selected)).toBe(graph.nodes.find((node) => node.event.uuid === "current").id);
  });
  it("keeps the source process visible when the process query omitted it at the node limit", () => {
    const source = event({ uuid: "source", time: "2026-01-01T02:00:00Z", "object.process.guid": "SOURCE" });
    const events = [
      event({ uuid: "first", time: "2026-01-01T00:00:00Z", "object.process.guid": "FIRST" }),
      event({ uuid: "second", time: "2026-01-01T01:00:00Z", "object.process.guid": "SECOND" }),
    ];
    const graph = buildProcessGraph(events, { maxNodes: 2, sourceEvent: source });
    expect(findSourceProcessNodeId(graph, source)).not.toBeNull();
    expect(graph.nodes.some((node) => node.event.uuid === "source")).toBe(true);
  });
  it("builds a selected source node even when the process query is empty", () => {
    const source = event({ uuid: "source-only", "object.process.guid": "SOURCE" });
    const graph = buildProcessGraph([], { sourceEvent: source });
    expect(findSourceProcessNodeId(graph, source)).toBe(graph.nodes[0].id);
  });
});
