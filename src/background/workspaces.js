import { addWorkspaceItem, createWorkspace, normalizeWorkspace } from "../shared/workspace.js";

const DATABASE_NAME = "apepatrol-investigations";
const DATABASE_VERSION = 1;
const STORE_NAME = "workspaces";

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}

let databasePromise;
function openDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
        store.createIndex("siemOrigin", "siemOrigin");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open ApePatrol workspace database"));
  });
  return databasePromise;
}

async function withStore(mode, callback) {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, mode);
  const result = await callback(transaction.objectStore(STORE_NAME));
  await transactionDone(transaction);
  return result;
}

export async function listWorkspaces() {
  const records = await withStore("readonly", (store) => requestResult(store.getAll()));
  return records.map((workspace) => normalizeWorkspace(workspace)).sort((first, second) => second.updatedAt - first.updatedAt);
}

export async function getWorkspace(id) {
  if (!id) return null;
  const record = await withStore("readonly", (store) => requestResult(store.get(String(id))));
  return record ? normalizeWorkspace(record) : null;
}

export async function createInvestigation(input) {
  const workspace = createWorkspace(input);
  await withStore("readwrite", (store) => requestResult(store.add(workspace)));
  return workspace;
}

export async function updateWorkspace(id, patch) {
  const existing = await getWorkspace(id);
  if (!existing) throw new Error("Workspace not found");
  const next = normalizeWorkspace({
    ...existing,
    title: patch?.title ?? existing.title,
    notes: patch?.notes ?? existing.notes,
    tags: patch?.tags ?? existing.tags,
    sourceIncidentId: patch?.sourceIncidentId ?? existing.sourceIncidentId,
    updatedAt: Date.now(),
  });
  await withStore("readwrite", (store) => requestResult(store.put(next)));
  return next;
}

export async function deleteWorkspace(id) {
  const existing = await getWorkspace(id);
  if (!existing) return false;
  await withStore("readwrite", (store) => requestResult(store.delete(String(id))));
  return true;
}

export async function removeWorkspaceItem(id, itemIndex) {
  const existing = await getWorkspace(id);
  if (!existing) throw new Error("Workspace not found");
  const index = Number(itemIndex);
  if (!Number.isInteger(index) || index < 0 || index >= existing.items.length) throw new TypeError("Invalid workspace item index");
  existing.items.splice(index, 1);
  existing.updatedAt = Date.now();
  await withStore("readwrite", (store) => requestResult(store.put(existing)));
  return existing;
}

export async function pinWorkspaceItem({ workspaceId, siemOrigin, sourceIncidentId, item }) {
  let workspace = workspaceId ? await getWorkspace(workspaceId) : null;
  if (!workspace) {
    const candidates = (await listWorkspaces()).filter((entry) => !siemOrigin || entry.siemOrigin === siemOrigin);
    workspace = candidates[0] ?? await createInvestigation({
      title: `Расследование ${new Date().toLocaleString("ru-RU")}`,
      siemOrigin,
      sourceIncidentId,
    });
  }
  const next = addWorkspaceItem(workspace, item);
  await withStore("readwrite", (store) => requestResult(store.put(next)));
  return next;
}
