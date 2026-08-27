(() => {
  "use strict";
  const marker = Symbol.for("apepatrol.network-interceptor.v3");
  if (window[marker]) return;

  const original = {
    open: XMLHttpRequest.prototype.open,
    send: XMLHttpRequest.prototype.send,
    fetch: window.fetch,
  };
  const requestUrls = new WeakMap();
  let enabled = false;
  let pending = null;

  const validState = (value) => value && typeof value === "object"
    && typeof value.token === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(value.token)
    && typeof value.description === "string" && value.description.length <= 500
    && typeof value.username === "string" && value.username.length <= 200
    && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now();

  const matches = (url, state) => {
    try {
      const parsed = new URL(url, location.origin);
      const match = parsed.pathname.match(/^\/api\/whitelists\/([^/]+)\/insert\/?$/);
      return parsed.origin === location.origin && match && decodeURIComponent(match[1]) === state.token;
    } catch {
      return false;
    }
  };

  const transform = (body, url) => {
    const state = pending;
    if (!enabled || !validState(state) || !matches(url, state) || typeof body !== "string") return body;
    try {
      const parsed = JSON.parse(body);
      if (!Array.isArray(parsed) || parsed.length < 3) return body;
      const next = [...parsed];
      next[2] = `${state.description} (${state.username})`;
      pending = null;
      return JSON.stringify(next);
    } catch {
      return body;
    }
  };

  function wrappedOpen(method, url, ...rest) {
    requestUrls.set(this, String(url));
    return original.open.call(this, method, url, ...rest);
  }
  function wrappedSend(body) {
    const transformed = transform(body, requestUrls.get(this));
    return original.send.call(this, transformed);
  }
  function wrappedFetch(input, init = {}) {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
    const body = transform(init.body, url);
    return original.fetch.call(this, input, body === init.body ? init : { ...init, body });
  }
  XMLHttpRequest.prototype.open = wrappedOpen;
  XMLHttpRequest.prototype.send = wrappedSend;
  window.fetch = wrappedFetch;

  const unpatch = () => {
    if (XMLHttpRequest.prototype.open === wrappedOpen) XMLHttpRequest.prototype.open = original.open;
    if (XMLHttpRequest.prototype.send === wrappedSend) XMLHttpRequest.prototype.send = original.send;
    if (window.fetch === wrappedFetch) window.fetch = original.fetch;
    delete window[marker];
  };
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "apepatrol") return;
    if (event.data.type === "bridge-config") {
      enabled = event.data.iocDescription === true;
      if (!enabled) pending = null;
    }
    if (event.data.type === "ioc-description" && enabled && validState(event.data)) pending = { ...event.data };
    if (event.data.type === "bridge-unpatch") unpatch();
  });
  Object.defineProperty(window, marker, { value: { unpatch }, configurable: true });
})();
