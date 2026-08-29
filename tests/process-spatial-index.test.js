import { describe, expect, it } from "vitest";
import { ProcessSpatialIndex } from "../src/process-graph/spatial-index.js";

describe("process graph spatial hit index", () => {
  it("finds only nodes intersecting the pointer cell", () => {
    const nodes = [
      { id: "near", x: 10, y: 10, radius: 12 },
      { id: "far", x: 10_000, y: 10_000, radius: 12 },
    ];
    const index = new ProcessSpatialIndex(80);
    index.rebuild(nodes, (node) => node, (node) => node.radius);
    expect(index.hit(11, 11)?.id).toBe("near");
    expect(index.hit(200, 200)).toBeNull();
  });

  it("indexes a large node across cell boundaries and returns the nearest overlap", () => {
    const large = { id: "large", x: 79, y: 79, radius: 30 };
    const nearer = { id: "nearer", x: 91, y: 91, radius: 20 };
    const index = new ProcessSpatialIndex(80);
    index.rebuild([large, nearer], (node) => node, (node) => node.radius);
    expect(index.hit(90, 90)?.id).toBe("nearer");
  });
});
