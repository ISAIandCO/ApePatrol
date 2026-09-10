import { filterProcessNodes as filter } from "@isaiandco/ape-share-core/graph/filters";
import { processFilterValues } from "./filter-values.js";
export { compileProcessTextFilter, processEventText, processFilterError } from "@isaiandco/ape-share-core/graph/filters";
export function filterProcessNodes(nodes, filters, selectedId) {
  return filter(nodes.map(node => ({ ...node, filterValues: node.filterValues ?? processFilterValues(node.event) })), filters, selectedId);
}
