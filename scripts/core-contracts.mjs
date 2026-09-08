import test from "node:test";
import assert from "node:assert/strict";
import { lookupIoc, IOC_API_PROVIDERS } from "../src/shared/core/ioc-enrichment.js";
import { classifyIp } from "../src/shared/core/ip.js";
import { chatEndpoint, requestChatCompletion } from "../src/shared/core/ai-transport.js";
import { compareEvents } from "../src/shared/core/event-compare.js";

const cases = [
  ["virustotal", "hash", "a".repeat(64), "GET", "x-apikey", "/api/v3/files/", { data: { attributes: { last_analysis_stats: { malicious: 1 } } } }],
  ["abuseipdb", "ip", "8.8.8.8", "GET", "Key", "/api/v2/check", { data: { abuseConfidenceScore: 80 } }],
  ["opentip", "domain", "evil.example", "GET", "x-api-key", "/api/v1/search/domain", { Zone: "Red" }],
  ["threatfox", "domain", "evil.example", "POST", "Auth-Key", "/api/v1/", { query_status: "ok", data: [{ malware: "test" }] }],
];
for (const [provider, type, value, method, header, path, body] of cases) {
  test(`${provider}: stable request and verdict contract`, async () => {
    const result = await lookupIoc(provider, { type, value }, { [IOC_API_PROVIDERS[provider].secret]: "  synthetic-key  " }, { fetchImpl: async (url, options) => {
      assert.equal(url.origin + "/*", IOC_API_PROVIDERS[provider].origin);
      assert.ok(url.pathname.startsWith(path));
      assert.equal(options.method, method);
      assert.equal(options.headers[header], "synthetic-key");
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      if (provider === "threatfox") assert.deepEqual(JSON.parse(options.body), { query: "search_ioc", search_term: value, exact_match: true });
      return Response.json(body);
    } });
    assert.equal(result.verdict, "malicious");
    assert.equal(result.type, type); assert.equal(result.value, value);
  });
}

test("ThreatFox hash lookup and absent/error reports stay distinct", async () => {
  const input = { type: "hash", value: "b".repeat(64) };
  const secrets = { threatFoxApiKey: "key" };
  const absent = await lookupIoc("threatfox", input, secrets, { fetchImpl: async (_url, options) => {
    assert.deepEqual(JSON.parse(options.body), { query: "search_hash", hash: input.value });
    return Response.json({ query_status: "hash_not_found" });
  } });
  assert.equal(absent.verdict, "clean-or-unknown");
  await assert.rejects(lookupIoc("threatfox", input, secrets, { fetchImpl: async () => Response.json({ query_status: "illegal_search_term" }) }), /illegal_search_term/);
});

test("provider auth, rate-limit and malformed results preserve error classification", async () => {
  const lookup = response => lookupIoc("virustotal", { type: "domain", value: "example.org" }, { virusTotalApiKey: "key" }, { fetchImpl: async () => response });
  await assert.rejects(lookup(new Response("", { status: 401 })), error => error.code === "PROVIDER_AUTH_FAILED" && error.status === 401);
  await assert.rejects(lookup(new Response("", { status: 429, headers: { "Retry-After": "12" } })), error => error.code === "PROVIDER_RATE_LIMIT" && error.retryAfterMs === 12000);
  await assert.rejects(lookup(Response.json({})), error => error.code === "PROVIDER_INVALID_RESPONSE");
});

test("local and mapped local addresses never reach an external provider", async () => {
  for (const value of ["10.0.0.1", "127.0.0.1", "::1", "::ffff:192.168.1.1", "::ffff:7f00:1", "2001:db8::1"]) {
    assert.notEqual(classifyIp(value), "public");
    await assert.rejects(lookupIoc("virustotal", { type: "ip", value }, { virusTotalApiKey: "key" }, { fetchImpl: () => assert.fail("Unexpected network") }), /not sent/);
  }
});

test("AI transport preserves preview bytes, endpoint and optional key", async () => {
  const serialized = '{"model":"test","messages":[]}';
  assert.equal(chatEndpoint("http://192.168.1.10:8000/v1", { expandBase: true }).pathname, "/v1/chat/completions");
  for (const apiKey of ["", " synthetic-key "]) {
    await requestChatCompletion("http://192.168.1.10:8000/custom/chat/completions?route=one", serialized, { apiKey, fetchImpl: async (url, options) => {
      assert.equal(url.pathname, "/custom/chat/completions"); assert.equal(url.search, "?route=one");
      assert.equal(options.body, serialized); assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, apiKey ? "Bearer synthetic-key" : undefined);
      return Response.json({ choices: [{ message: { content: "ok" } }] });
    } });
  }
});

test("AI cancellation, body-read timeout and invalid response", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(requestChatCompletion("http://localhost/v1/chat/completions", "{}", { signal: controller.signal, fetchImpl: async (_url, options) => {
    assert.equal(options.signal.aborted, true); throw new DOMException("cancelled", "AbortError");
  } }), { name: "AbortError" });
  await assert.rejects(requestChatCompletion("http://localhost/ai", "{}", { timeoutMs: 5, fetchImpl: async (_url, options) => ({ ok: true, json: () => new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true })) }) }), /время ожидания/);
  await assert.rejects(requestChatCompletion("http://localhost/ai", "{}", { fetchImpl: async () => Response.json({}) }), /response schema/);
});

test("comparison accepts the product field grouping without changing diff semantics", () => {
  const result = compareEvents([{ SourceAddress: "1", nested: { a: 1, b: 2 } }, { SourceAddress: "2", nested: { b: 2, a: 1 } }], { fieldGroup: field => field.includes("address") ? "network" : "raw" });
  assert.equal(result.groups.network[0].status, "changed");
  assert.equal(result.groups.raw[0].status, "same");
});
