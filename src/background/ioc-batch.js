import { ERROR_CODES } from "../shared/errors.js";
import {
  IOC_BATCH_CACHE_KEY,
  iocBatchCacheKey,
  normalizeIocBatchResult,
  pruneIocCache,
  readIocCache,
} from "../shared/ioc-batch.js";
import { normalizeIoc } from "../shared/ioc.js";
import { loadSecrets, loadSettings } from "../shared/storage.js";
import { IOC_API_PROVIDERS, lookupIoc } from "./ioc-enrichment.js";

const activeBatches = new Map();

function delay(milliseconds, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new DOMException("IOC batch cancelled", "AbortError"));
      return;
    }
    const finish = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("IOC batch cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function validateJobs(input) {
  if (!Array.isArray(input) || !input.length || input.length > 200) throw new TypeError("IOC batch must contain between 1 and 200 jobs");
  const unique = new Map();
  for (const job of input) {
    const definition = IOC_API_PROVIDERS[job?.provider];
    const type = job?.ioc?.type;
    const value = normalizeIoc(type, job?.ioc?.value);
    if (!definition || !definition.types.includes(type) || !value) throw new TypeError("IOC batch contains an unsupported job");
    unique.set(`${job.provider}\n${type}\n${value}`, { provider: job.provider, ioc: { type, value } });
  }
  return [...unique.values()];
}

async function runLimited(jobs, concurrency, worker, signal) {
  const results = new Array(jobs.length);
  let cursor = 0;
  const runner = async () => {
    while (cursor < jobs.length) {
      const index = cursor++;
      if (signal.aborted) {
        results[index] = { ...jobs[index], status: "cancelled", errorCode: ERROR_CODES.PROCESS_QUERY_ABORTED, error: "Batch cancelled" };
        continue;
      }
      results[index] = await worker(jobs[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, runner));
  return results;
}

export async function runIocBatch(message, {
  storageArea = browser.storage.local,
  permissionCheck = (provider) => browser.permissions.contains({ origins: [provider.origin] }),
  lookup = lookupIoc,
} = {}) {
  if (message?.confirmed !== true) throw new Error("Operator confirmation is required for IOC batch enrichment");
  const requestId = String(message.requestId ?? "");
  if (!/^[a-f\d-]{8,64}$/i.test(requestId) || activeBatches.has(requestId)) throw new TypeError("Invalid or duplicate IOC batch request ID");
  const jobs = validateJobs(message.jobs);
  const controller = new AbortController();
  activeBatches.set(requestId, controller);
  try {
    const [settings, secrets, stored] = await Promise.all([
      loadSettings(),
      loadSecrets(),
      storageArea.get(IOC_BATCH_CACHE_KEY),
    ]);
    if (!settings.features.batchIoc) throw new Error("Batch IOC enrichment is disabled");
    const cache = pruneIocCache(stored[IOC_BATCH_CACHE_KEY]);
    const freshEntries = {};
    const worker = async (job) => {
      const definition = IOC_API_PROVIDERS[job.provider];
      const ttlMinutes = settings.iocBatch.cacheTtlMinutes[job.provider] ?? 60;
      const ttlMs = ttlMinutes * 60_000;
      const key = iocBatchCacheKey(job);
      if (!message.bypassCache) {
        const cached = readIocCache(cache, key);
        if (cached) return { ...cached, cached: true };
      }
      if (!await permissionCheck(definition)) return {
        ...job,
        status: "error",
        errorCode: ERROR_CODES.PROVIDER_PERMISSION_REQUIRED,
        error: `Доступ к API ${definition.name} не выдан`,
      };
      let attempt = 0;
      while (attempt <= settings.iocBatch.maxRetries) {
        try {
          const result = await lookup(job.provider, job.ioc, secrets, { signal: controller.signal });
          const normalized = normalizeIocBatchResult(job, result, { ttlMs });
          freshEntries[key] = normalized;
          return normalized;
        } catch (error) {
          if (controller.signal.aborted) return { ...job, status: "cancelled", errorCode: ERROR_CODES.PROCESS_QUERY_ABORTED, error: "Batch cancelled" };
          const retryable = [ERROR_CODES.PROVIDER_RATE_LIMIT, ERROR_CODES.PROVIDER_UNAVAILABLE].includes(error.code);
          if (!retryable || attempt >= settings.iocBatch.maxRetries) return {
            ...job,
            status: "error",
            errorCode: error.code ?? ERROR_CODES.PROVIDER_UNAVAILABLE,
            error: error.message,
            retryable,
          };
          const wait = Math.min(30_000, error.retryAfterMs ?? 500 * (2 ** attempt));
          try {
            await delay(wait, controller.signal);
          } catch (delayError) {
            if (controller.signal.aborted) return { ...job, status: "cancelled", errorCode: ERROR_CODES.PROCESS_QUERY_ABORTED, error: "Batch cancelled" };
            throw delayError;
          }
          attempt += 1;
        }
      }
      return { ...job, status: "error", errorCode: ERROR_CODES.PROVIDER_UNAVAILABLE, error: "Provider request failed" };
    };
    const results = await runLimited(jobs, settings.iocBatch.concurrency, worker, controller.signal);
    await storageArea.set({ [IOC_BATCH_CACHE_KEY]: pruneIocCache({ ...cache, ...freshEntries }) });
    return {
      requestId,
      results,
      summary: {
        total: results.length,
        ok: results.filter((result) => result.status === "ok").length,
        cached: results.filter((result) => result.cached).length,
        errors: results.filter((result) => result.status === "error").length,
        cancelled: results.filter((result) => result.status === "cancelled").length,
      },
    };
  } finally {
    activeBatches.delete(requestId);
  }
}

export function cancelIocBatch(requestId) {
  const controller = activeBatches.get(String(requestId ?? ""));
  if (!controller) return false;
  controller.abort(new DOMException("IOC batch cancelled", "AbortError"));
  return true;
}
