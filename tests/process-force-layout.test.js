import { describe, expect, it } from "vitest";
import { applyRepulsion, DEFAULT_FORCE_SETTINGS, forceIterationLimit, normalizeForceSettings, seedComponentLayout, stabilizeForceNode } from "../src/process-graph/force-layout.js";

describe("large process force layout", () => {
  it("bounds repulsion work for a dense 10,000-node graph", () => {
    const nodes = Array.from({ length: 10_000 }, (_, index) => ({ id: `node-${index}`, x: 0, y: 0, vx: 0, vy: 0, radius: 10 }));
    const comparisons = applyRepulsion(nodes, 1);
    expect(comparisons).toBeLessThanOrEqual(nodes.length * 24);
    expect(nodes.every((node) => Number.isFinite(node.vx) && Number.isFinite(node.vy))).toBe(true);
    expect(forceIterationLimit(nodes.length)).toBeLessThan(60);
  });

  it("recovers invalid coordinates and keeps a node inside the layout boundary", () => {
    const node = { x: Number.POSITIVE_INFINITY, y: -50_000, vx: Number.NaN, vy: 1_000 };
    stabilizeForceNode(node, 1, 1_000);
    expect([node.x, node.y, node.vx, node.vy].every(Number.isFinite)).toBe(true);
    expect(Math.abs(node.x)).toBeLessThanOrEqual(1_000);
    expect(Math.abs(node.y)).toBeLessThanOrEqual(1_000);
    expect(Math.hypot(node.vx, node.vy)).toBeLessThanOrEqual(40);
  });

  it("normalizes saved force controls and lets repulsion be disabled", () => {
    expect(normalizeForceSettings({ attraction: -1, repulsion: 99, linkStrength: "bad", linkDistance: 250 })).toEqual({
      attraction: 0,
      repulsion: 30,
      linkStrength: DEFAULT_FORCE_SETTINGS.linkStrength,
      linkDistance: 250,
    });
    const nodes = [{ id: "a", x: 0, y: 0, vx: 0, vy: 0, radius: 10 }, { id: "b", x: 5, y: 0, vx: 0, vy: 0, radius: 10 }];
    applyRepulsion(nodes, 1, 0);
    expect(nodes.every((node) => node.vx === 0 && node.vy === 0)).toBe(true);
  });

  it("starts components already separated and parent/child levels already readable", () => {
    const nodes = [
      { id: "root", parentId: null, time: 1, radius: 10, selected: true },
      { id: "child", parentId: "root", time: 2, radius: 10 },
      { id: "isolated-a", parentId: null, time: 3, radius: 10 },
      { id: "isolated-b", parentId: null, time: 4, radius: 10 },
    ];
    const boundary = seedComponentLayout(nodes, 100);
    expect(nodes.find((node) => node.id === "child").y).toBeGreaterThan(nodes.find((node) => node.id === "root").y);
    expect(new Set(nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(nodes.length);
    expect(nodes.every((node) => node.anchorX === node.x && node.anchorY === node.y)).toBe(true);
    expect(boundary).toBeGreaterThanOrEqual(1000);
  });
});
