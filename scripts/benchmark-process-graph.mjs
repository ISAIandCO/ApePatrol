import { performance } from "node:perf_hooks";
import { buildProcessGraph } from "../src/siem/process/graph.js";

function fixture(size) {
  const start = Date.UTC(2026, 0, 1);
  return Array.from({ length: size }, (_, index) => ({
    uuid: `event-${index}`,
    time: new Date(start + index * 1000).toISOString(),
    msgid: "1",
    "event_src.host": "benchmark-host",
    "object.process.guid": `process-${index}`,
    ...(index ? { "object.process.parent.guid": `process-${index - 1}` } : {}),
  }));
}

const results = [];
for (const size of [1000, 5000, 10000]) {
  const events = fixture(size);
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const graph = buildProcessGraph(events, { maxNodes: size, maxDepth: size + 1 });
  const durationMs = performance.now() - started;
  const heapDeltaMiB = Math.max(0, process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
  const edges = graph.nodes.filter((node) => node.parentId).length;
  if (graph.nodes.length !== size || edges !== size - 1) throw new Error(`Invalid ${size}-node benchmark graph`);
  if (graph.diagnostics.parentIndexLookups > size * 2) throw new Error(`Parent lookup regression at ${size} nodes`);
  results.push({ size, durationMs: Number(durationMs.toFixed(2)), heapDeltaMiB: Number(heapDeltaMiB.toFixed(2)), edges, parentIndexLookups: graph.diagnostics.parentIndexLookups });
}
console.table(results);
