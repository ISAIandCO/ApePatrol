import { iocFromField } from "./ioc.js";
export * from "@isaiandco/ape-share-core/ioc/batch";
export const IOC_BATCH_CACHE_KEY = "apePatrolIocBatchCacheV1";

export function collectEventIocs(event) {
  const found = new Map();
  for (const [field, value] of Object.entries(event ?? {})) {
    const ioc = iocFromField(field, value);
    if (!ioc) continue;
    const key = `${ioc.type}:${ioc.value}`;
    const current = found.get(key) ?? { ...ioc, fields: [] };
    current.fields.push(field);
    found.set(key, current);
  }
  return [...found.values()].sort((first, second) => first.type.localeCompare(second.type) || first.value.localeCompare(second.value));
}
