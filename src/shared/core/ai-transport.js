import { parseSafeExternalUrl } from "./url.js";

// Product adapters own endpoint policy, permissions, secrets and payload confirmation.
export function chatEndpoint(value, { expandBase = false } = {}) {
  const endpoint = parseSafeExternalUrl(String(value));
  if (!endpoint) throw new TypeError("Invalid AI endpoint");
  if (expandBase && /^(?:\/|.*\/v1\/?)$/.test(endpoint.pathname)) endpoint.pathname = `${endpoint.pathname.replace(/\/$/, "")}/chat/completions`;
  return endpoint;
}

export async function requestChatCompletion(endpoint, serialized, { apiKey = "", timeoutMs = 120000, fetchImpl = fetch, signal } = {}) {
  const url = chatEndpoint(endpoint);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal?.aborted) controller.abort(signal.reason);
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = { Accept: "application/json", "Content-Type": "application/json; charset=utf-8" };
    if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
    const response = await fetchImpl(url, { method: "POST", headers, body: serialized, credentials: "omit", redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error(`AI: HTTP ${response.status}`);
    const body = await response.json();
    const message = body?.choices?.[0]?.message;
    if (!message || (typeof message.content !== "string" && !Array.isArray(message.tool_calls))) throw new Error("Unexpected AI response schema");
    return message;
  } catch (error) {
    if (error?.name === "AbortError" && !signal?.aborted) throw new Error(`AI: превышено время ожидания ${timeoutMs / 1000} секунд`);
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}
