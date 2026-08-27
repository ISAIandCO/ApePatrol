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

export class SiemApiClient {
  constructor(origin, { timeout = DEFAULT_TIMEOUT, fetchImpl = fetch } = {}) {
    this.origin = new URL(origin).origin;
    this.timeout = timeout;
    this.fetchImpl = fetchImpl;
    this.cache = new Map();
  }

  clearCache() {
    this.cache.clear();
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
        headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        const kind = response.status === 401 ? "unauthorized" : response.status === 403 ? "forbidden" : response.status === 404 ? "unsupported" : "http";
        throw new SiemApiError(kind, `${method} ${path} failed with HTTP ${response.status}`, { status: response.status, path });
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
      throw new SiemApiError("network", `${method} ${path} failed`, { path, cause: error });
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
    const body = { filter, groupValues: null, timeFrom, timeTo };
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

  createSavedFilter(filter, options = {}) {
    return this.request("/api/v3/events/filters", { ...options, method: "POST", body: filter });
  }

  deleteSavedFilter(id, options = {}) {
    return this.request(`/api/v3/events/filters/${encodeURIComponent(id)}`, { ...options, method: "DELETE" });
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

  addTableListRow(token, row, options = {}) {
    return this.request(`/api/whitelists/${encodeURIComponent(token)}/insert`, { ...options, method: "POST", body: row });
  }

  removeTableListRow(token, row, options = {}) {
    return this.request(`/api/whitelists/${encodeURIComponent(token)}/remove`, { ...options, method: "POST", body: row });
  }
}
