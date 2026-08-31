export class SiemApiError extends Error {
  constructor(kind, message, details = {}) {
    super(message);
    this.name = "SiemApiError";
    this.kind = kind;
    this.status = details.status ?? null;
    this.path = details.path ?? null;
    this.cause = details.cause;
  }
}

const DEFAULT_TIMEOUT = 15000;
const READ_ONLY_POST_PATHS = [
  "/api/events/v2/events",
  "/api/events/v2/events/count_distinct_field_values",
  "/api/assets_temporal_readmodel/v1/assets_grid",
];

function errorDetail(text, type = "") {
  text = String(text ?? "").trim();
  if (!text) return "";
  if (type.includes("json")) {
    try {
      const body = JSON.parse(text);
      const detail = body?.message ?? body?.error?.message ?? body?.error ?? body?.detail ?? body?.title;
      if (typeof detail === "string") return detail.replace(/\s+/g, " ").slice(0, 240);
    } catch { /* Fall through to safe plain text. */ }
  }
  return /[<>]/.test(text) ? "" : text.replace(/\s+/g, " ").slice(0, 240);
}

async function responseErrorDetail(response) {
  let text;
  try { text = (await response.text()).trim(); } catch { return ""; }
  return errorDetail(text, response.headers.get("content-type") ?? "");
}

function apiTime(value) {
  if (value === undefined || value === null) return value;
  if (typeof value === "number") return value;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new TypeError("Invalid SIEM event search time range");
  return Math.floor(timestamp / 1000);
}

export function filterAvailableEventFields(metadata, requested) {
  if (!Array.isArray(metadata?.fields)) return [...new Set(requested)];
  const available = new Set(metadata.fields.filter((field) => field?.filterable === true).map((field) => field.name));
  const selected = [...new Set(requested)].filter((field) => available.has(field) || field === "time" || field === "subevents");
  return selected.length ? selected : [...new Set(requested)];
}

function canRetryWithXhr(method, path) {
  if (method === "GET") return true;
  if (method !== "POST") return false;
  const pathname = new URL(path, "https://apepatrol.invalid").pathname;
  return READ_ONLY_POST_PATHS.includes(pathname);
}

export class SiemApiClient {
  constructor(origin, {
    timeout = DEFAULT_TIMEOUT,
    fetchImpl = fetch,
    xhrFactory = typeof XMLHttpRequest === "function" ? () => new XMLHttpRequest() : null,
  } = {}) {
    this.origin = new URL(origin).origin;
    this.timeout = timeout;
    this.fetchImpl = fetchImpl;
    this.xhrFactory = xhrFactory;
    this.cache = new Map();
  }

  clearCache() {
    this.cache.clear();
  }

  requestWithXhr(path, { method, body, signal, timeout }) {
    return new Promise((resolve, reject) => {
      const xhr = this.xhrFactory();
      const abort = () => xhr.abort();
      const finish = (callback, value) => {
        signal?.removeEventListener("abort", abort);
        callback(value);
      };
      xhr.open(method, new URL(path, this.origin));
      xhr.withCredentials = true;
      xhr.timeout = timeout;
      xhr.setRequestHeader("Accept", "application/json");
      if (body !== undefined) xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          const kind = xhr.status === 401 ? "unauthorized" : xhr.status === 403 ? "forbidden" : xhr.status === 404 ? "unsupported" : "http";
          const detail = errorDetail(xhr.responseText, xhr.getResponseHeader("content-type") ?? "");
          finish(reject, new SiemApiError(kind, `${method} ${path} failed with HTTP ${xhr.status}${detail ? `: ${detail}` : ""}`, { status: xhr.status, path }));
          return;
        }
        if (xhr.status === 204) {
          finish(resolve, null);
          return;
        }
        const type = xhr.getResponseHeader("content-type") ?? "";
        if (!type.includes("json")) {
          finish(reject, new SiemApiError("invalid-response", `${path} did not return JSON`, { path }));
          return;
        }
        try {
          finish(resolve, JSON.parse(xhr.responseText));
        } catch (cause) {
          finish(reject, new SiemApiError("invalid-response", `${path} returned invalid JSON`, { path, cause }));
        }
      };
      xhr.onerror = () => finish(reject, new SiemApiError("network", `${method} ${path} failed using both Fetch and XHR`, { path }));
      xhr.ontimeout = () => finish(reject, new SiemApiError("timeout", `${method} ${path} timed out`, { path }));
      xhr.onabort = () => finish(reject, new SiemApiError("cancelled", `${method} ${path} was cancelled`, { path }));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      else xhr.send(body === undefined ? null : JSON.stringify(body));
    });
  }

  async request(path, { method = "GET", body, signal, timeout = this.timeout } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeout);
    const abort = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const response = await this.fetchImpl(new URL(path, this.origin), {
        method,
        credentials: "include",
        headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json; charset=utf-8" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const kind = response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : response.status === 404 ? "unsupported" : "http";
        const detail = await responseErrorDetail(response);
        throw new SiemApiError(kind, `${method} ${path} failed with HTTP ${response.status}${detail ? `: ${detail}` : ""}`, { status: response.status, path });
      }
      if (response.status === 204) return null;
      const type = response.headers.get("content-type") ?? "";
      if (!type.includes("json")) throw new SiemApiError("invalid-response", `${path} did not return JSON`, { path });
      try {
        return await response.json();
      } catch (cause) {
        throw new SiemApiError("invalid-response", `${path} returned invalid JSON`, { path, cause });
      }
    } catch (error) {
      if (error instanceof SiemApiError) throw error;
      if (controller.signal.aborted) {
        const kind = signal?.aborted ? "cancelled" : "timeout";
        throw new SiemApiError(kind, `${method} ${path} ${kind === "timeout" ? "timed out" : "was cancelled"}`, { path, cause: error });
      }
      // Some MP SIEM builds accept authenticated XMLHttpRequest but terminate Fetch.
      // Retry only reads: automatically replaying writes could duplicate mutations.
      if (this.xhrFactory && canRetryWithXhr(method, path)) {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        return this.requestWithXhr(path, { method, body, signal, timeout });
      }
      const detail = typeof error?.message === "string" ? `: ${error.message}` : "";
      throw new SiemApiError("network", `${method} ${path} failed${detail}`, { path, cause: error });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }
  }

  async cached(key, ttl, loader) {
    const existing = this.cache.get(key);
    if (existing && existing.expires > Date.now()) return existing.value;
    const value = await loader();
    this.cache.set(key, { value, expires: Date.now() + ttl });
    return value;
  }

  getEventMetadata(options) {
    return this.cached("eventMetadata", 30 * 60_000, () => this.request("/api/events/v2/events_metadata", options));
  }

  searchEvents({ where, select, timeFrom, timeTo, limit = 1000, offset = 0, order = "ascending", scope = {}, signal }) {
    const filter = {
      select: [...new Set(select)],
      where,
      orderBy: [{ field: "time", sortOrder: order }],
      groupBy: [],
      aggregateBy: [],
      distributeBy: [],
      top: null,
      aliases: {},
    };
    const body = { filter, groupValues: null, timeFrom: apiTime(timeFrom), timeTo: apiTime(timeTo) };
    for (const key of ["searchType", "searchSources", "localSources", "groupIds"]) {
      if (scope[key] !== undefined && scope[key] !== null) body[key] = scope[key];
    }
    return this.request(`/api/events/v2/events?limit=${Math.max(1, Math.min(limit, 10000))}&offset=${Math.max(0, offset)}`, {
      method: "POST",
      body,
      signal,
    });
  }

  countDistinctEventFields({ where, fields, timeFrom, timeTo, top = null, signal }) {
    return this.request("/api/events/v2/events/count_distinct_field_values", {
      method: "POST",
      body: { filter: where, fields, timeFrom, timeTo, top },
      signal,
    });
  }

  getRegisteredApplications(options) {
    return this.cached("registeredApps", 10 * 60_000, () => this.request("/api/tenants/v2/menu", options));
  }

  getTableLists(options) {
    return this.cached("tableLists", 5 * 60_000, () => this.request("/api/events/v2/table_lists", options));
  }

  getCurrentUser(options) {
    return this.cached("currentUser", 5 * 60_000, () => this.request("/api/account/userinfo", options));
  }

  getCorrelationRule(name, options) {
    return this.cached(`rule:${name}`, 10 * 60_000, () => this.request(`/api/siem/v2/rules/correlation/${encodeURIComponent(name)}`, options));
  }

  getFilterHierarchy(options) {
    return this.cached("filterHierarchy", 5 * 60_000, () => this.request("/api/v2/events/filters_hierarchy", options));
  }

  getSavedFilter(id, options) {
    return this.request(`/api/v3/events/filters/${encodeURIComponent(id)}?withRemoved=false`, options);
  }

  getAssets(query, options = {}) {
    return this.request("/api/assets_temporal_readmodel/v1/assets_grid", { ...options, method: "POST", body: query });
  }

  getAssetGridData(token, { limit = 1, ...options } = {}) {
    return this.request(`/api/assets_temporal_readmodel/v1/assets_grid/data?limit=${Math.max(1, Math.min(limit, 100))}&pdqlToken=${encodeURIComponent(token)}`, options);
  }

  discoverEdrAgent(agentId, options = {}) {
    return this.cached(`edr:${agentId}`, 5 * 60_000, () => this.request(`/api/edr/v1/agents/${encodeURIComponent(agentId)}/discovery`, options));
  }

}
