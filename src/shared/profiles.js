import { createSettingsProfiles } from "@isaiandco/ape-share-core/settings/profiles";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings.js";
export const { SETTINGS_PROFILE_VERSION, exportSettingsProfile, parseSettingsProfile, importSettingsProfile, normalizeManagedPolicy, applyManagedPolicy, prepareManagedSettingsSave } = createSettingsProfiles({ defaults: DEFAULT_SETTINGS, normalize: normalizeSettings, kind: "apepatrol-settings-profile" });
