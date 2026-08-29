const DEFAULT_TIMEOUT = 30000;
const MAX_REQUEST_BYTES = 5 * 1024 * 1024;

const ROUTES = [
  ["GET", /^\/api\/events\/v2\/events_metadata$/],
  ["GET", /^\/api\/events\/v2\/table_lists$/],
  ["GET", /^\/api\/tenants\/v2\/menu$/],
  ["GET", /^\/api\/account\/userinfo$/],
  ["GET", /^\/api\/siem\/v2\/rules\/correlation\/[^/]+$/],
  ["GET", /^\/api\/v2\/events\/filters_hierarchy$/],
  ["GET", /^\/api\/v3\/events\/filters\/[^/]+$/],
  ["GET", /^\/api\/assets_temporal_readmodel\/v1\/assets_grid\/data$/],
  ["GET", /^\/api\/edr\/v1\/agents\/[^/]+\/discovery$/],
  ["POST", /^\/api\/events\/v2\/events$/],
  ["POST", /^\/api\/events\/v2\/events\/count_distinct_field_values$/],
  ["POST", /^\/api\/assets_temporal_readmodel\/v1\/assets_grid$/],
];

const MUTATION_ROUTES = [
  ["POST", /^\/api\/whitelists\/[^/]+\/(?:insert|remove)$/],
];

export function resolveAllowedSiemApiUrl(origin, path, method = "GET") {
  return resolveRoute(origin, path, method, ROUTES);
}

export function resolveAllowedSiemMutationUrl(origin, path, method = "GET") {
  return resolveRoute(origin, path, method, MUTATION_ROUTES);
}

function resolveRoute(origin, path, method, routes) {
  const normalizedOrigin = new URL(origin).origin;
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    throw new Error("Invalid SIEM API path");
  }
  const url = new URL(path, normalizedOrigin);
  const normalizedMethod = String(method).toUpperCase();
  if (url.origin !== normalizedOrigin || url.hash || !routes.some(([allowedMethod, pattern]) => allowedMethod === normalizedMethod && pattern.test(url.pathname))) {
    throw new Error(`SIEM API route is not allowed: ${normalizedMethod} ${url.pathname}`);
  }
  return url;
}

function requestWithXhr(url, { method, body, timeout, xhrFactory }) {
  return new Promise((resolve, reject) => {
    const xhr = xhrFactory();
    xhr.open(method, url.href);
    xhr.withCredentials = true;
    xhr.timeout = timeout;
    xhr.setRequestHeader("Accept", "application/json");
    if (body !== undefined) xhr.setRequestHeader("Content-Type", "application/json; charset=utf-8");
    xhr.onload = () => {
      if (xhr.responseURL && new URL(xhr.responseURL).origin !== url.origin) {
        reject(new Error("SIEM API redirected outside the configured origin"));
        return;
      }
      resolve({
        status: xhr.status,
        statusText: xhr.statusText,
        contentType: xhr.getResponseHeader("content-type") ?? "",
        bodyText: xhr.status === 204 ? "" : xhr.responseText,
      });
    };
    xhr.onerror = () => reject(new Error(`${method} ${url.pathname} failed in the extension background (XHR)`));
    xhr.ontimeout = () => reject(new Error(`${method} ${url.pathname} timed out in the extension background`));
    xhr.onabort = () => reject(new Error(`${method} ${url.pathname} was aborted in the extension background`));
    xhr.send(body ?? null);
  });
}

export async function proxySiemApiRequest(origin, request, {
  fetchImpl = fetch,
  xhrFactory = typeof XMLHttpRequest === "function" ? () => new XMLHttpRequest() : null,
  timeout = DEFAULT_TIMEOUT,
} = {}) {
  return proxyRequest(origin, request, resolveAllowedSiemApiUrl, { fetchImpl, xhrFactory, timeout });
}

export async function proxySiemMutationRequest(origin, request, {
  fetchImpl = fetch,
  xhrFactory = typeof XMLHttpRequest === "function" ? () => new XMLHttpRequest() : null,
  timeout = DEFAULT_TIMEOUT,
} = {}) {
  return proxyRequest(origin, request, resolveAllowedSiemMutationUrl, { fetchImpl, xhrFactory, timeout });
}

async function proxyRequest(origin, request, resolver, { fetchImpl, xhrFactory, timeout }) {
  const method = String(request?.method ?? "GET").toUpperCase();
  const url = resolver(origin, request?.path, method);
  const body = request?.body;
  if (body !== undefined && typeof body !== "string") throw new Error("SIEM API body must be serialized JSON");
  if (body !== undefined && new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) throw new Error("SIEM API request body is too large");
  if (body !== undefined) JSON.parse(body);

  // The original SiemMonkey popup used authenticated XMLHttpRequest. Keeping
  // that transport in the extension background avoids Firefox binding the
  // request to MaxPatrol's page lifecycle while preserving proven SIEM behavior.
  if (xhrFactory) return requestWithXhr(url, { method, body, timeout, xhrFactory });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), timeout);
  try {
    const response = await fetchImpl(url, {
      method,
      credentials: "include",
      redirect: "error",
      headers: body === undefined
        ? { Accept: "application/json" }
        : { Accept: "application/json", "Content-Type": "application/json; charset=utf-8" },
      body,
      signal: controller.signal,
    });
    return {
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers.get("content-type") ?? "",
      bodyText: response.status === 204 ? "" : await response.text(),
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`${method} ${url.pathname} timed out in the extension background`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
