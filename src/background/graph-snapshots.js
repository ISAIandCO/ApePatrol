const SNAPSHOT_PREFIX = "apepatrolGraphSnapshot:";
const MAX_SNAPSHOTS = 10;
const MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024;
const ID_PATTERN = /^[a-f\d-]{36}$/i;

function snapshotKey(id) { return `${SNAPSHOT_PREFIX}${id}`; }

function validateOrigin(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== value) throw new TypeError("Invalid process graph origin");
  return url.origin;
}

function validateSnapshot(input) {
  if (!input || typeof input !== "object" || !Array.isArray(input.response?.graph?.nodes)) throw new TypeError("Invalid process graph snapshot");
  if (input.response.graph.nodes.length > 10_000) throw new TypeError("Process graph snapshot contains too many nodes");
  const origin = validateOrigin(input.response.origin);
  const record = {
    schemaVersion: 1,
    createdAt: Date.now(),
    sourceTabId: Number.isInteger(input.sourceTabId) && input.sourceTabId > 0 ? input.sourceTabId : null,
    sourceEvent: input.sourceEvent && typeof input.sourceEvent === "object" ? structuredClone(input.sourceEvent) : {},
    response: { ...structuredClone(input.response), origin },
  };
  if (new TextEncoder().encode(JSON.stringify(record)).byteLength > MAX_SNAPSHOT_BYTES) throw new TypeError("Process graph snapshot is too large");
  return record;
}

async function pruneSnapshots(storageArea) {
  const stored = await storageArea.get(null);
  const snapshots = Object.entries(stored)
    .filter(([key, value]) => key.startsWith(SNAPSHOT_PREFIX) && Number.isFinite(value?.createdAt))
    .sort((first, second) => second[1].createdAt - first[1].createdAt);
  const expiredKeys = snapshots.slice(MAX_SNAPSHOTS).map(([key]) => key);
  if (expiredKeys.length) await storageArea.remove(expiredKeys);
}

export async function saveGraphSnapshot(input, storageArea = browser.storage.session) {
  const id = crypto.randomUUID();
  const snapshot = { id, ...validateSnapshot(input) };
  await storageArea.set({ [snapshotKey(id)]: snapshot });
  await pruneSnapshots(storageArea);
  return { id, createdAt: snapshot.createdAt };
}

export async function getGraphSnapshot(id, storageArea = browser.storage.session) {
  if (!ID_PATTERN.test(String(id ?? ""))) throw new TypeError("Invalid process graph snapshot ID");
  const key = snapshotKey(id);
  return (await storageArea.get(key))[key] ?? null;
}

export async function updateGraphSnapshot(id, input, storageArea = browser.storage.session) {
  if (!ID_PATTERN.test(String(id ?? ""))) throw new TypeError("Invalid process graph snapshot ID");
  const existing = await getGraphSnapshot(id, storageArea);
  if (!existing) throw new Error("Process graph snapshot not found");
  const validated = validateSnapshot({
    sourceTabId: input?.sourceTabId ?? existing.sourceTabId,
    sourceEvent: input?.sourceEvent ?? existing.sourceEvent,
    response: input?.response,
  });
  const snapshot = { ...validated, id: existing.id, createdAt: existing.createdAt, updatedAt: Date.now() };
  await storageArea.set({ [snapshotKey(id)]: snapshot });
  return { id: snapshot.id, createdAt: snapshot.createdAt, updatedAt: snapshot.updatedAt };
}

export async function deleteGraphSnapshot(id, storageArea = browser.storage.session) {
  if (!ID_PATTERN.test(String(id ?? ""))) return false;
  await storageArea.remove(snapshotKey(id));
  return true;
}
