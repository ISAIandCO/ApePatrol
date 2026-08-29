import { describe, expect, it } from "vitest";
import { prepareAiRequest } from "../src/shared/ai-payload.js";

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
});
