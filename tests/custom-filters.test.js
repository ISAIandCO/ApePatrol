import { describe, expect, it } from "vitest";
import { BUILTIN_FILTERS, renderFilterTemplate, requiredTemplateFields } from "../src/siem/features/custom-filters.js";

describe("custom filter templates", () => {
  it("finds required fields", () => expect(requiredTemplateFields("src.ip='${src.ip}' and dst.ip='${dst.ip}'")).toEqual(["src.ip", "dst.ip"]));
  it("escapes attacker-controlled event values", () => {
    const rendered = renderFilterTemplate("subject.name = '${subject.name}'", { "subject.name": "x' or true or '" });
    expect(rendered.query).toBe("subject.name = 'x\\' or true or \\''");
  });
  it("reports missing fields", () => expect(renderFilterTemplate("src.ip='${src.ip}'", {}).missing).toEqual(["src.ip"]));
  it("ships a broad Russian-described investigation library", () => {
    expect(BUILTIN_FILTERS.length).toBeGreaterThanOrEqual(25);
    expect(BUILTIN_FILTERS.every((filter) => /[А-Яа-яЁё]/.test(filter.name) && /[А-Яа-яЁё]/.test(filter.description))).toBe(true);
    expect(BUILTIN_FILTERS.some((filter) => filter.timeRange === "30d")).toBe(true);
  });
});

it("does not offer the registry template for Unix paths or unknown platforms", async () => {
  const { BUILTIN_FILTERS, customFilterSupportsEvent, normalizeCustomFilter } = await import("../src/siem/features/custom-filters.js");
  const filter = normalizeCustomFilter(BUILTIN_FILTERS.find(item => item.id === "registry-key-host"));
  expect(customFilterSupportsEvent(filter, { "object.path": "/etc/passwd", "event_src.host": "unix" })).toBe(false);
  expect(customFilterSupportsEvent(filter, { "event_src.product": "Linux", "object.path": "HKEY_LOCAL_MACHINE\\Software" })).toBe(false);
  expect(customFilterSupportsEvent(filter, {})).toBe(false);
  expect(customFilterSupportsEvent(filter, { "event_src.product": "Windows" })).toBe(true);
  expect(customFilterSupportsEvent(BUILTIN_FILTERS[0], {})).toBe(true);
});
