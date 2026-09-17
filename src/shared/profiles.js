import { createSettingsProfiles } from "@isaiandco/ape-share-core/settings/profiles";
import { splitLegacyFilters } from "@isaiandco/ape-share-core/filters/catalog";
import { BUILTIN_FILTERS } from "../siem/features/custom-filters.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settings.js";

const profiles = createSettingsProfiles({ defaults: DEFAULT_SETTINGS, normalize: normalizeSettings, kind: "apepatrol-settings-profile" });
export const { SETTINGS_PROFILE_VERSION, exportSettingsProfile, parseSettingsProfile } = profiles;

function migrateFilterSettings(input) {
  return input && input.userFilters === undefined && Array.isArray(input.customFilters)
    ? { ...input, ...splitLegacyFilters(input.customFilters, BUILTIN_FILTERS) } : input;
}

export function normalizeManagedPolicy(input) {
  const policy = profiles.normalizeManagedPolicy(input);
  if (policy.defaults.userFilters !== undefined || !Array.isArray(policy.defaults.customFilters)) return policy;
  const defaults = migrateFilterSettings(policy.defaults);
  delete defaults.customFilters;
  const lockedPaths = policy.lockedPaths.flatMap(path => path === "customFilters" ? ["userFilters", "disabledBuiltinFilterIds"] : [path]);
  return profiles.normalizeManagedPolicy({ ...policy, defaults, lockedPaths });
}
export function applyManagedPolicy(input, policy, overrides = []) {
  const paths = overrides.flatMap(path => path === "customFilters" ? ["userFilters", "disabledBuiltinFilterIds"] : [path]);
  return profiles.applyManagedPolicy(migrateFilterSettings(input), normalizeManagedPolicy(policy), paths);
}
export function prepareManagedSettingsSave(next, previous, policy, overrides = []) {
  const paths = overrides.flatMap(path => path === "customFilters" ? ["userFilters", "disabledBuiltinFilterIds"] : [path]);
  return profiles.prepareManagedSettingsSave(migrateFilterSettings(next), migrateFilterSettings(previous), normalizeManagedPolicy(policy), paths);
}
export function importSettingsProfile(current, input, strategy) {
  const profile = profiles.parseSettingsProfile(input);
  return profiles.importSettingsProfile(migrateFilterSettings(current), { ...profile, settings: migrateFilterSettings(profile.settings) }, strategy);
}
