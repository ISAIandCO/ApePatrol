import { describe, expect, it } from "vitest";
import { BUILTIN_PROVIDERS, DEFAULT_SETTINGS, LEGACY_LOCAL_SECRETS_KEY, LEGACY_SYNC_STORAGE_KEY, LOCAL_SECRETS_KEY, migrateLegacySettings, normalizeSettings, SYNC_STORAGE_KEY } from "../src/shared/settings.js";

describe("settings schema", () => {
  it("normalizes a clean first install", () => expect(normalizeSettings()).toEqual(DEFAULT_SETTINGS));
  it("keeps explicit ApePatrol keys and the SiemMonkey migration aliases", () => {
    expect(SYNC_STORAGE_KEY).toBe("apePatrolSettings");
    expect(LOCAL_SECRETS_KEY).toBe("apePatrolSecrets");
    expect(LEGACY_SYNC_STORAGE_KEY).toBe("siemMonkeySettings");
    expect(LEGACY_LOCAL_SECRETS_KEY).toBe("siemMonkeySecrets");
  });
  it("fills missing properties and removes invalid origins/providers", () => {
    const settings = normalizeSettings({ instances: ["https://siem.test", "javascript:bad"], features: { processTree: false }, externalProviders: [{ type: "ip", urlTemplate: "javascript:${ip}" }] });
    expect(settings.instances).toEqual(["https://siem.test"]);
    expect(settings.features.processTree).toBe(false);
    expect(settings.features.eventActions).toBe(true);
    expect(settings.externalProviders).toHaveLength(BUILTIN_PROVIDERS.length);
    expect(settings.externalProviders.every((provider) => provider.urlTemplate.startsWith("https://"))).toBe(true);
  });
  it("migrates the vt key mismatch and separates secrets", () => {
    const migrated = migrateLegacySettings({ options: { "vt-api-key": "old", llm_api_key: "llm", iplinks: [], hashlinks: [] } });
    expect(migrated.secrets).toEqual({ virusTotalApiKey: "old", llmApiKey: "llm" });
    expect(JSON.stringify(migrated.settings)).not.toContain("old");
    expect(JSON.stringify(migrated.settings)).not.toContain("llm");
  });
  it("migrates legacy selected AI fields without weakening the new allowlist mode", () => {
    const migrated = normalizeSettings({ schemaVersion: 4, ai: { mode: "selected", allowFields: ["uuid", "time"] } });
    expect(migrated.schemaVersion).toBe(6);
    expect(migrated.ai.selectedFields).toEqual(["uuid", "time"]);
    expect(migrated.ai.allowFields).toEqual(["uuid", "time"]);
    expect(normalizeSettings({ ai: { mode: "allowlist", allowFields: ["uuid"] } }).ai.mode).toBe("allowlist");
  });
});
