import { describe, expect, it } from "vitest";
import { getGraphSnapshot, saveGraphSnapshot, updateGraphSnapshot } from "../src/background/graph-snapshots.js";

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      if (key === null) return { ...data };
      return Object.hasOwn(data, key) ? { [key]: data[key] } : {};
    },
    async set(values) { Object.assign(data, values); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; },
  };
}

function snapshot(index = 1) {
  return {
    sourceTabId: 42,
    sourceEvent: { uuid: `source-${index}` },
    response: {
      origin: "https://siem.example",
      sourceNodeId: "node-1",
      graph: { nodes: [{ id: "node-1", parentId: null, children: [], event: { uuid: `event-${index}` } }], roots: ["node-1"], truncated: false },
    },
  };
}

describe("autonomous process graph snapshots", () => {
  it("round-trips a versioned graph in transient storage", async () => {
    const storage = memoryStorage();
    const saved = await saveGraphSnapshot(snapshot(), storage);
    const restored = await getGraphSnapshot(saved.id, storage);
    expect(restored).toMatchObject({
      id: saved.id,
      schemaVersion: 1,
      sourceTabId: 42,
      sourceEvent: { uuid: "source-1" },
      response: { origin: "https://siem.example", sourceNodeId: "node-1" },
    });
  });

  it("rejects unsafe origins and oversized node collections", async () => {
    const storage = memoryStorage();
    await expect(saveGraphSnapshot({ ...snapshot(), response: { ...snapshot().response, origin: "javascript:alert(1)" } }, storage)).rejects.toThrow("origin");
    const tooLarge = snapshot();
    tooLarge.response.graph.nodes = Array.from({ length: 10_001 }, (_, index) => ({ id: String(index) }));
    await expect(saveGraphSnapshot(tooLarge, storage)).rejects.toThrow("too many");
  });

  it("keeps only the ten newest snapshots", async () => {
    const storage = memoryStorage();
    for (let index = 0; index < 12; index += 1) await saveGraphSnapshot(snapshot(index), storage);
    expect(Object.keys(storage.data)).toHaveLength(10);
  });

  it("updates an expanded graph while preserving snapshot identity", async () => {
    const storage = memoryStorage();
    const saved = await saveGraphSnapshot(snapshot(1), storage);
    const expanded = snapshot(2);
    expanded.response.graph.nodes.push({ id: "node-2", parentId: "node-1", children: [], event: { uuid: "event-2" } });
    await updateGraphSnapshot(saved.id, expanded, storage);
    const restored = await getGraphSnapshot(saved.id, storage);
    expect(restored.id).toBe(saved.id);
    expect(restored.createdAt).toBe(saved.createdAt);
    expect(restored.response.graph.nodes).toHaveLength(2);
    expect(restored.updatedAt).toEqual(expect.any(Number));
  });
});
