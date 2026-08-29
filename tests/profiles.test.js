import { describe, expect, it } from "vitest";
import { applyManagedPolicy, exportSettingsProfile, importSettingsProfile, parseSettingsProfile, prepareManagedSettingsSave } from "../src/shared/profiles.js";
import { DEFAULT_SETTINGS } from "../src/shared/settings.js";

describe("Enterprise Profiles", () => {
  it("round-trips a versioned non-secret settings profile", () => {
    const profile = exportSettingsProfile({ ...DEFAULT_SETTINGS, debugLogging: true, secrets: { llmApiKey: "super-secret-value" } });
    expect(profile).toMatchObject({ kind: "apepatrol-settings-profile", schemaVersion: 1 });
    expect(profile).not.toHaveProperty("secrets");
    expect(JSON.stringify(profile)).not.toContain("super-secret-value");
    expect(parseSettingsProfile(JSON.stringify(profile)).settings.debugLogging).toBe(true);
  });

  it("supports merge and replace strategies", () => {
    const profile = { kind: "apepatrol-settings-profile", schemaVersion: 1, settings: { debugLogging: true } };
    expect(importSettingsProfile({ ...DEFAULT_SETTINGS, iocListName: "Custom" }, profile, "merge")).toMatchObject({ debugLogging: true, iocListName: "Custom" });
    expect(importSettingsProfile(DEFAULT_SETTINGS, profile, "replace").debugLogging).toBe(true);
  });

  it("applies managed defaults and locks only declared paths", () => {
    const result = applyManagedPolicy({ features: { aiAssistant: true, batchIoc: false }, iocListName: "User" }, {
      schemaVersion: 1,
      defaults: { features: { aiAssistant: false, batchIoc: true }, iocListName: "Managed" },
      lockedPaths: ["features.aiAssistant", "iocListName"],
    }, ["features.batchIoc"]);
    expect(result.settings.features).toMatchObject({ aiAssistant: false, batchIoc: false });
    expect(result.settings.iocListName).toBe("Managed");
    expect(result.managed.lockedPaths).toEqual(["features.aiAssistant", "iocListName"]);
  });

  it("rejects unknown profile schemas", () => {
    expect(() => parseSettingsProfile({ kind: "apepatrol-settings-profile", schemaVersion: 99, settings: {} })).toThrow("Unsupported");
  });

  it("preserves a user's prior values while managed locks are active", () => {
    const policy = { defaults: { features: { batchIoc: false } }, lockedPaths: ["features.batchIoc"] };
    const stored = { ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, batchIoc: true } };
    const submittedResolvedForm = { ...DEFAULT_SETTINGS, features: { ...DEFAULT_SETTINGS.features, batchIoc: false }, debugLogging: true };
    const prepared = prepareManagedSettingsSave(submittedResolvedForm, stored, policy);
    expect(prepared.userSettings.features.batchIoc).toBe(true);
    expect(prepared.userSettings.debugLogging).toBe(true);
    expect(applyManagedPolicy(prepared.userSettings, policy, prepared.overridePaths).settings.features.batchIoc).toBe(false);
  });

  it("applies unlocked defaults until the user explicitly overrides them", () => {
    const policy = { defaults: { iocListName: "Managed" }, lockedPaths: [] };
    const firstLoad = applyManagedPolicy(DEFAULT_SETTINGS, policy, []);
    expect(firstLoad.settings.iocListName).toBe("Managed");
    const submitted = { ...firstLoad.settings, iocListName: "Analyst" };
    const prepared = prepareManagedSettingsSave(submitted, DEFAULT_SETTINGS, policy, []);
    expect(prepared.overridePaths).toEqual(["iocListName"]);
    expect(applyManagedPolicy(prepared.userSettings, policy, prepared.overridePaths).settings.iocListName).toBe("Analyst");
  });
});
