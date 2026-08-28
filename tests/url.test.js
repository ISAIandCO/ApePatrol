import { describe, expect, it } from "vitest";
import { fillUrlTemplate, normalizeOrigin, parseSafeExternalUrl } from "../src/shared/url.js";
import { buildEventSearchUrl } from "../src/siem/features/related-events.js";

describe("safe URLs", () => {
  it.each(["https://example.com/a", "http://10.0.0.1/path"])("allows %s", (value) => expect(parseSafeExternalUrl(value)?.href).toBe(value));
  it.each(["javascript:alert(1)", "data:text/html,x", "file:///tmp/a", "custom:thing", "not a URL"])("rejects %s", (value) => expect(parseSafeExternalUrl(value)).toBeNull());
  it("rejects credentials and pathful origins", () => {
    expect(parseSafeExternalUrl("https://user:pass@example.com/")).toBeNull();
    expect(normalizeOrigin("https://example.com/siem")).toBeNull();
  });
  it("encodes provider values", () => expect(fillUrlTemplate("https://example.com/${ip}", { ip: "2001:db8::1" })?.href).toBe("https://example.com/2001%3Adb8%3A%3A1"));
  it("puts SPA search parameters after the hash route", () => {
    const url = buildEventSearchUrl("https://siem.example", "uuid = 'a'", "2026-01-01T00:00:00Z", "5m");
    expect(url).toMatch(/^https:\/\/siem\.example\/#\/events\/view\?where=/);
    expect(url).not.toContain(".example/?where");
    const parameters = new URLSearchParams(new URL(url).hash.split("?")[1]);
    expect(parameters.get("start")).toBe(String(Date.parse("2026-01-01T00:00:00Z") - 300_000));
    expect(parameters.get("end")).toBe(String(Date.parse("2026-01-01T00:00:00Z") + 300_000));
  });
  it("treats a numeric SIEM time string as epoch seconds, not milliseconds", () => {
    const url = buildEventSearchUrl("https://siem.example", "uuid = 'a'", "1767225600", "5m");
    const parameters = new URLSearchParams(new URL(url).hash.split("?")[1]);
    expect(parameters.get("start")).toBe(String(1_767_225_600_000 - 300_000));
  });
});
