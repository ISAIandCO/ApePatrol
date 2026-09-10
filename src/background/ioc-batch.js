import { createIocBatchRunner } from "@isaiandco/ape-share-core/ioc/runner";
import { loadSecrets, loadSettings } from "../shared/storage.js";
import { IOC_BATCH_CACHE_KEY } from "../shared/ioc-batch.js";
const runner = createIocBatchRunner({ loadSecrets, loadSettings, cacheKey: IOC_BATCH_CACHE_KEY,
  storageArea: { get: (...args) => browser.storage.local.get(...args), set: (...args) => browser.storage.local.set(...args) },
  permissionCheck: provider => browser.permissions.contains({ origins: [provider.origin] }),
});
export const { runIocBatch, cancelIocBatch } = runner;
