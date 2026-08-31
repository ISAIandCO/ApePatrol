import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSecrets, loadSettings, MANAGED_OVERRIDE_PATHS_KEY, saveSettings } from "../src/shared/storage.js";
import {
  LEGACY_LOCAL_SECRETS_KEY,
  LEGACY_SYNC_STORAGE_KEY,
  LOCAL_SECRETS_KEY,
  SYNC_STORAGE_KEY,
  DEFAULT_SETTINGS,
} from "../src/shared/settings.js";

describe("ApePatrol storage migration", () => {
  beforeEach(() => {
    globalThis.browser = {
      storage: {
        sync: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
        local: { get: vi.fn().mockResolvedValue({}), set: vi.fn(), remove: vi.fn() },
      },
    };
  });

  it("moves SiemMonkey settings without losing instances or custom data", async () => {
    const legacy = {
      instances: ["https://siem.example"],
      customFilters: [{ id: "custom", name: "Custom", template: "uuid = ${uuid}", timeRange: "1h", enabled: true }],
      externalProviders: [{ id: "hash", name: "Hash", type: "hash", urlTemplate: "https://example.test/${hash}", enabled: true }],
    };
    browser.storage.sync.get.mockResolvedValue({ [LEGACY_SYNC_STORAGE_KEY]: legacy });

    const migrated = await loadSettings();

    expect(migrated.instances).toEqual(["https://siem.example"]);
    expect(migrated.customFilters.find((filter) => filter.id === "custom")?.template).toBe("uuid = ${uuid}");
    expect(migrated.externalProviders.find((provider) => provider.id === "hash")?.urlTemplate).toBe("https://example.test/${hash}");
    expect(browser.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({ [SYNC_STORAGE_KEY]: migrated }));
    expect(browser.storage.sync.remove).toHaveBeenCalledWith(LEGACY_SYNC_STORAGE_KEY);
  });

  it("moves locally stored API keys without exposing them to sync storage", async () => {
    const legacy = { virusTotalApiKey: "vt-secret", llmApiKey: "llm-secret" };
    browser.storage.local.get.mockResolvedValue({ [LEGACY_LOCAL_SECRETS_KEY]: legacy });

    const migrated = await loadSecrets();

    expect(migrated).toMatchObject(legacy);
    expect(migrated.abuseIpDbApiKey).toBe("");
    expect(browser.storage.local.set).toHaveBeenCalledWith({ [LOCAL_SECRETS_KEY]: migrated });
    expect(browser.storage.local.remove).toHaveBeenCalledWith(LEGACY_LOCAL_SECRETS_KEY);
    expect(browser.storage.sync.set).not.toHaveBeenCalled();
  });

  it("persists user settings underneath a managed lock", async () => {
    const stored = { ...structuredClone(DEFAULT_SETTINGS), debugLogging: false };
    browser.storage.managed = { get: vi.fn().mockResolvedValue({
      settingsProfile: JSON.stringify({ defaults: { features: { batchIoc: false } }, lockedPaths: ["features.batchIoc"] }),
    }) };
    browser.storage.local.get.mockResolvedValue({ [SYNC_STORAGE_KEY]: stored, [MANAGED_OVERRIDE_PATHS_KEY]: [] });
    const saved = await saveSettings({ ...stored, features: { ...stored.features, batchIoc: false }, debugLogging: true });
    expect(saved).toMatchObject({ features: { batchIoc: false }, debugLogging: true });
    expect(browser.storage.local.set).toHaveBeenCalledWith(expect.objectContaining({
      [SYNC_STORAGE_KEY]: expect.objectContaining({ features: expect.objectContaining({ batchIoc: true }), debugLogging: true }),
      [MANAGED_OVERRIDE_PATHS_KEY]: [],
    }));
  });
});
