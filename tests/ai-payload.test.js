import { describe, expect, it } from "vitest";
import { normalizeAiToolCalls, prepareAiRequest } from "../src/shared/ai-payload.js";

function settings(overrides = {}) {
  return {
    model: "soc-model",
    mode: "selected",
    selectedFields: [],
    allowFields: [],
    denyFields: ["password", "token", "authorization", "cookie", "secret"],
    maxBytes: 64_000,
    ...overrides,
  };
}

describe("AI privacy preview", () => {
  it("shows the exact selected-fields request and real UTF-8 size", async () => {
    const result = await prepareAiRequest({ uuid: "событие", password: "secret" }, settings(), { selectedFields: ["uuid"] });
    expect(result.sentFields).toEqual(["uuid"]);
    expect(result.serialized).toContain("событие");
    expect(result.serialized).not.toContain("password");
    expect(result.byteLength).toBe(new TextEncoder().encode(result.serialized).byteLength);
    expect(result.byteLength).toBeGreaterThan(result.serialized.length);
  });

  it("keeps allowlist and redacted modes distinct", async () => {
    const event = { uuid: "event", email: "analyst@example.test", api_token: "do-not-send" };
    const allowlist = await prepareAiRequest(event, settings({ mode: "allowlist", allowFields: ["uuid"] }), { selectedFields: ["email", "api_token"] });
    expect(allowlist.sentFields).toEqual(["uuid"]);
    const redacted = await prepareAiRequest(event, settings({ mode: "redacted" }));
    expect(redacted.sentFields).toEqual(["uuid", "email"]);
    expect(redacted.warnings).toContain("Email-like content in: email");
  });

  it("warns for full mode without describing it as safe", async () => {
    const result = await prepareAiRequest({ authorization: "Bearer abcdefghijklmnop" }, settings({ mode: "full" }));
    expect(result.warnings.join(" ")).toMatch(/Full mode/);
    expect(result.warnings.join(" ")).toMatch(/secret-bearing|Credential-like/);
    expect(result.warnings.join(" ")).not.toMatch(/safe/i);
  });

  it("omits the largest fields until the exact final body fits", async () => {
    const result = await prepareAiRequest({ small: "ok", huge: "я".repeat(20_000) }, settings({ maxBytes: 1024 }), { selectedFields: ["small", "huge"] });
    expect(result.byteLength).toBeLessThanOrEqual(1024);
    expect(result.omittedFields).toBeGreaterThan(0);
    expect(result.body.messages[1].content).toContain("truncated");
  });

  it("changes the preview hash when the outbound event changes", async () => {
    const first = await prepareAiRequest({ uuid: "one" }, settings(), { selectedFields: ["uuid"] });
    const second = await prepareAiRequest({ uuid: "two" }, settings(), { selectedFields: ["uuid"] });
    expect(first.hash).not.toBe(second.hash);
  });

  it("builds an exact multi-turn request with attached events and optional tools", async () => {
    const result = await prepareAiRequest({}, settings(), {
      selectedFields: ["uuid"],
      contextType: "tab",
      allowSiemTools: true,
      conversation: [
        { role: "user", content: "Compare", attachments: [{ type: "event", value: "one", label: "One", snapshot: { uuid: "one", password: "no" } }] },
        { role: "assistant", content: "Need another event" },
        { role: "user", content: "Here", attachments: [{ type: "event", value: "two", label: "Two", snapshot: { uuid: "two" } }] },
      ],
    });
    expect(result.body.messages).toHaveLength(4);
    expect(result.body.tools.map((tool) => tool.function.name)).toContain("get_related_events");
    expect(result.serialized).toContain("one");
    expect(result.serialized).not.toContain("password");
  });

  it("accepts only known, valid tool calls", () => {
    const calls = normalizeAiToolCalls({ tool_calls: [
      { id: "1", function: { name: "get_asset_context", arguments: "{}" } },
      { id: "2", function: { name: "delete_incident", arguments: "{}" } },
      { id: "3", function: { name: "get_rule_context", arguments: "not-json" } },
    ] }, "tab");
    expect(calls).toEqual([{ id: "1", name: "get_asset_context", arguments: {} }]);
  });
});
