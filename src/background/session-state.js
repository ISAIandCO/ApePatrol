const DATABASE_NAME = "apepatrol-session-state";
const DATABASE_VERSION = 1;
const STORE_NAME = "records";

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
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open ApePatrol session database"));
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

export const indexedDbSessionStorage = {
  async get(key) {
    if (key === null) {
      const records = await withStore("readonly", (store) => requestResult(store.getAll()));
      return Object.fromEntries(records.map((record) => [record.key, record.value]));
    }
    const record = await withStore("readonly", (store) => requestResult(store.get(String(key))));
    return record ? { [record.key]: record.value } : {};
  },
  async set(values) {
    await withStore("readwrite", (store) => Promise.all(Object.entries(values).map(([key, value]) => requestResult(store.put({ key, value })))));
  },
  async remove(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    await withStore("readwrite", (store) => Promise.all(list.map((key) => requestResult(store.delete(String(key))))));
  },
  async clear() {
    await withStore("readwrite", (store) => requestResult(store.clear()));
  },
};
