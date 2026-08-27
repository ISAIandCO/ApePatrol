import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, migrateLegacySettings, normalizeSettings } from "../src/shared/settings.js";

describe("settings schema", () => {
  it("normalizes a clean first install", () => expect(normalizeSettings()).toEqual(DEFAULT_SETTINGS));
  it("fills missing properties and removes invalid origins/providers", () => {
    const settings = normalizeSettings({ instances: ["https://siem.test", "javascript:bad"], features: { processTree: false }, externalProviders: [{ type: "ip", urlTemplate: "javascript:${ip}" }] });
    expect(settings.instances).toEqual(["https://siem.test"]);
    expect(settings.features.processTree).toBe(false);
    expect(settings.features.eventActions).toBe(true);
    expect(settings.externalProviders).toEqual([]);
  });
  it("migrates the vt key mismatch and separates secrets", () => {
    const migrated = migrateLegacySettings({ options: { "vt-api-key": "old", llm_api_key: "llm", iplinks: [], hashlinks: [] } });
    expect(migrated.secrets).toEqual({ virusTotalApiKey: "old", llmApiKey: "llm" });
    expect(JSON.stringify(migrated.settings)).not.toContain("old");
    expect(JSON.stringify(migrated.settings)).not.toContain("llm");
  });
});
