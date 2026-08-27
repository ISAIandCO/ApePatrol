import {
  LOCAL_SECRETS_KEY,
  LEGACY_LOCAL_SECRETS_KEY,
  LEGACY_SYNC_STORAGE_KEY,
  SYNC_STORAGE_KEY,
  migrateLegacySettings,
  normalizeSecrets,
  normalizeSettings,
} from "./settings.js";

export async function loadSettings() {
  const stored = await browser.storage.sync.get([SYNC_STORAGE_KEY, LEGACY_SYNC_STORAGE_KEY, "options"]);
  if (stored[SYNC_STORAGE_KEY]) return normalizeSettings(stored[SYNC_STORAGE_KEY]);
  if (stored[LEGACY_SYNC_STORAGE_KEY]) {
    const migrated = normalizeSettings(stored[LEGACY_SYNC_STORAGE_KEY]);
    await Promise.all([
      browser.storage.sync.set({ [SYNC_STORAGE_KEY]: migrated }),
      browser.storage.sync.remove(LEGACY_SYNC_STORAGE_KEY),
    ]);
    return migrated;
  }
  if (stored.options) {
    const migrated = migrateLegacySettings(stored);
    await Promise.all([
      browser.storage.sync.set({ [SYNC_STORAGE_KEY]: migrated.settings }),
      browser.storage.local.set({ [LOCAL_SECRETS_KEY]: migrated.secrets }),
      browser.storage.sync.remove("options"),
    ]);
    return migrated.settings;
  }
  const settings = normalizeSettings();
  await browser.storage.sync.set({ [SYNC_STORAGE_KEY]: settings });
  return settings;
}

export async function saveSettings(input) {
  const settings = normalizeSettings(input);
  await browser.storage.sync.set({ [SYNC_STORAGE_KEY]: settings });
  return settings;
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
