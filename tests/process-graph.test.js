import { describe, expect, it } from "vitest";
import { buildProcessGraph, buildProcessSearchPredicate } from "../src/siem/process/graph.js";

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
  it("supports missing GUID and respects max nodes", () => expect(buildProcessGraph([event(), event({ uuid: "2" })], { maxNodes: 1 }).truncated).toBe(true));
});
