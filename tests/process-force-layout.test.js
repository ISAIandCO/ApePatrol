import { describe, expect, it } from "vitest";
import { applyRepulsion, forceIterationLimit, stabilizeForceNode } from "../src/process-graph/force-layout.js";

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
});
