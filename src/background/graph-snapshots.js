import { createGraphSnapshots } from "@isaiandco/ape-share-core/graph/snapshots";
import { indexedDbSessionStorage } from "./session-state.js";
export const { saveGraphSnapshot, getGraphSnapshot, updateGraphSnapshot, deleteGraphSnapshot } = createGraphSnapshots({
  storage: indexedDbSessionStorage, prefix: "apepatrolGraphSnapshot:", idPattern: /^[a-f\d-]{36}$/i,
});
