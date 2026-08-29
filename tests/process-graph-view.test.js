import { describe, expect, it } from "vitest";
import { buildProcessGraph } from "../src/siem/process/graph.js";
import { buildProcessGraphView, processNodeDetails, processNodeRadius } from "../src/siem/process/view-model.js";

const event = (overrides = {}) => ({
  uuid: crypto.randomUUID(),
  time: "2026-01-01T00:00:00Z",
  "event_src.host": "host",
  "object.process.id": "10",
  "object.process.name": "process.exe",
  ...overrides,
});

describe("process graph view model", () => {
  it("creates directed parent-to-child edges and sizes nodes by their degree", () => {
    const root = event({ uuid: "root", "object.process.id": "1" });
    const childA = event({ uuid: "a", "object.process.id": "2", "object.process.parent.id": "1" });
    const childB = event({ uuid: "b", "object.process.id": "3", "object.process.parent.id": "1" });
    const graph = buildProcessGraph([root, childA, childB]);
    const view = buildProcessGraphView(graph, graph.nodes.find((node) => node.event.uuid === "a").id);
    expect(view.edges).toHaveLength(2);
    expect(view.nodes.find((node) => node.event.uuid === "root").connectionCount).toBe(2);
    expect(view.nodes.find((node) => node.event.uuid === "root").radius).toBeGreaterThan(view.nodes.find((node) => node.event.uuid === "a").radius);
    expect(view.nodes.find((node) => node.event.uuid === "a").selected).toBe(true);
  });

  it("keeps radius bounded for very highly connected nodes", () => {
    expect(processNodeRadius(0)).toBe(10);
    expect(processNodeRadius(10_000)).toBe(34);
  });

  it("returns detailed hover fields without HTML rendering", () => {
    const details = processNodeDetails(event({ "object.process.cmdline": "<img onerror=alert(1)>" }));
    expect(details).toContainEqual({ label: "Командная строка", value: "<img onerror=alert(1)>" });
  });
});
