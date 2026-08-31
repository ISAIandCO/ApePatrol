import {
  LOCAL_SECRETS_KEY,
  LEGACY_LOCAL_SECRETS_KEY,
  LEGACY_SYNC_STORAGE_KEY,
  SYNC_STORAGE_KEY,
  migrateLegacySettings,
  normalizeSecrets,
  normalizeSettings,
} from "./settings.js";
import { applyManagedPolicy, normalizeManagedPolicy, prepareManagedSettingsSave } from "./profiles.js";

export const MANAGED_OVERRIDE_PATHS_KEY = "apePatrolManagedOverridePaths";

async function loadManagedPolicy() {
  try {
    return normalizeManagedPolicy(await browser.storage.managed.get(null));
  } catch {
    return normalizeManagedPolicy();
  }
}

async function resolveSettings(userSettings, overridePaths = []) {
  return applyManagedPolicy(userSettings, await loadManagedPolicy(), overridePaths);
}

export async function loadSettings() {
  const [local, stored] = await Promise.all([
    browser.storage.local.get([SYNC_STORAGE_KEY, MANAGED_OVERRIDE_PATHS_KEY]),
    browser.storage.sync.get([SYNC_STORAGE_KEY, LEGACY_SYNC_STORAGE_KEY, "options", MANAGED_OVERRIDE_PATHS_KEY]),
  ]);
  const overridePaths = local[MANAGED_OVERRIDE_PATHS_KEY] ?? stored[MANAGED_OVERRIDE_PATHS_KEY];
  if (local[SYNC_STORAGE_KEY]) return (await resolveSettings(local[SYNC_STORAGE_KEY], overridePaths)).settings;
  if (stored[SYNC_STORAGE_KEY]) {
    await Promise.all([
      browser.storage.local.set({ [SYNC_STORAGE_KEY]: stored[SYNC_STORAGE_KEY], [MANAGED_OVERRIDE_PATHS_KEY]: overridePaths ?? [] }),
      browser.storage.sync.remove([SYNC_STORAGE_KEY, MANAGED_OVERRIDE_PATHS_KEY]),
    ]);
    return (await resolveSettings(stored[SYNC_STORAGE_KEY], overridePaths)).settings;
  }
  if (stored[LEGACY_SYNC_STORAGE_KEY]) {
    const migrated = normalizeSettings(stored[LEGACY_SYNC_STORAGE_KEY]);
    await Promise.all([
      browser.storage.local.set({ [SYNC_STORAGE_KEY]: migrated, [MANAGED_OVERRIDE_PATHS_KEY]: overridePaths ?? [] }),
      browser.storage.sync.remove(LEGACY_SYNC_STORAGE_KEY),
    ]);
    return (await resolveSettings(migrated, overridePaths)).settings;
  }
  if (stored.options) {
    const migrated = migrateLegacySettings(stored);
    await Promise.all([
      browser.storage.local.set({ [SYNC_STORAGE_KEY]: migrated.settings, [LOCAL_SECRETS_KEY]: migrated.secrets, [MANAGED_OVERRIDE_PATHS_KEY]: overridePaths ?? [] }),
      browser.storage.sync.remove("options"),
    ]);
    return (await resolveSettings(migrated.settings, overridePaths)).settings;
  }
  const settings = normalizeSettings();
  await browser.storage.local.set({ [SYNC_STORAGE_KEY]: settings, [MANAGED_OVERRIDE_PATHS_KEY]: [] });
  return (await resolveSettings(settings, overridePaths)).settings;
}

export async function loadSettingsState() {
  const settings = await loadSettings();
  const policy = await loadManagedPolicy();
  return { settings, managed: { lockedPaths: policy.lockedPaths, active: Boolean(Object.keys(policy.defaults).length) } };
}

export async function saveSettings(input) {
  const [stored, policy] = await Promise.all([
    browser.storage.local.get([SYNC_STORAGE_KEY, MANAGED_OVERRIDE_PATHS_KEY]),
    loadManagedPolicy(),
  ]);
  const prepared = prepareManagedSettingsSave(input, stored[SYNC_STORAGE_KEY], policy, stored[MANAGED_OVERRIDE_PATHS_KEY]);
  await browser.storage.local.set({ [SYNC_STORAGE_KEY]: prepared.userSettings, [MANAGED_OVERRIDE_PATHS_KEY]: prepared.overridePaths });
  return applyManagedPolicy(prepared.userSettings, policy, prepared.overridePaths).settings;
}

export async function loadSecrets() {
  const stored = await browser.storage.local.get([LOCAL_SECRETS_KEY, LEGACY_LOCAL_SECRETS_KEY]);
  if (stored[LOCAL_SECRETS_KEY]) return normalizeSecrets(stored[LOCAL_SECRETS_KEY]);
  if (stored[LEGACY_LOCAL_SECRETS_KEY]) {
    const migrated = normalizeSecrets(stored[LEGACY_LOCAL_SECRETS_KEY]);
    await Promise.all([
      browser.storage.local.set({ [LOCAL_SECRETS_KEY]: migrated }),
      browser.storage.local.remove(LEGACY_LOCAL_SECRETS_KEY),
    ]);
    return migrated;
  }
  return normalizeSecrets();
}

export async function saveSecrets(input) {
  const secrets = normalizeSecrets(input);
  await browser.storage.local.set({ [LOCAL_SECRETS_KEY]: secrets });
  return secrets;
}
