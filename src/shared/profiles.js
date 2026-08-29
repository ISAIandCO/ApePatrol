import { DEFAULT_SETTINGS, normalizeSettings } from "./settings.js";

export const SETTINGS_PROFILE_VERSION = 1;
const BLOCKED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

function plainObject(value) { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }

function deepMerge(...sources) {
  const target = {};
  for (const source of sources) {
    if (!plainObject(source)) continue;
    for (const [key, value] of Object.entries(source)) {
      if (BLOCKED_KEYS.has(key)) continue;
      target[key] = plainObject(value) ? deepMerge(plainObject(target[key]) ? target[key] : {}, value) : structuredClone(value);
    }
  }
  return target;
}

function getPath(object, path) { return path.split(".").reduce((value, part) => value?.[part], object); }
function setPath(object, path, value) {
  const parts = path.split(".");
  let target = object;
  for (const part of parts.slice(0, -1)) {
    if (BLOCKED_KEYS.has(part)) return;
    target[part] = plainObject(target[part]) ? target[part] : {};
    target = target[part];
  }
  if (!BLOCKED_KEYS.has(parts.at(-1))) target[parts.at(-1)] = structuredClone(value);
}

function leafPaths(value, prefix = "") {
  if (!plainObject(value) || !Object.keys(value).length) return prefix ? [prefix] : [];
  return Object.entries(value).flatMap(([key, item]) => BLOCKED_KEYS.has(key) ? [] : leafPaths(item, prefix ? `${prefix}.${key}` : key));
}

function sameValue(first, second) {
  if (Object.is(first, second)) return true;
  if (!first || !second || typeof first !== "object" || typeof second !== "object") return false;
  const firstKeys = Object.keys(first).sort();
  const secondKeys = Object.keys(second).sort();
  return firstKeys.length === secondKeys.length && firstKeys.every((key, index) => key === secondKeys[index] && sameValue(first[key], second[key]));
}

function isLocked(path, lockedPaths) { return lockedPaths.some((locked) => path === locked || path.startsWith(`${locked}.`)); }

export function exportSettingsProfile(settings) {
  return {
    kind: "apepatrol-settings-profile",
    schemaVersion: SETTINGS_PROFILE_VERSION,
    exportedAt: new Date().toISOString(),
    settings: normalizeSettings(settings),
  };
}

export function parseSettingsProfile(input) {
  const profile = typeof input === "string" ? JSON.parse(input) : input;
  if (!plainObject(profile) || profile.kind !== "apepatrol-settings-profile") throw new TypeError("Not an ApePatrol settings profile");
  if (profile.schemaVersion !== SETTINGS_PROFILE_VERSION) throw new TypeError(`Unsupported settings profile schema ${profile.schemaVersion}`);
  if (!plainObject(profile.settings)) throw new TypeError("Settings profile has no settings object");
  return { ...profile, settings: deepMerge(profile.settings) };
}

export function importSettingsProfile(current, profile, strategy = "replace") {
  const parsed = parseSettingsProfile(profile);
  if (!["replace", "merge"].includes(strategy)) throw new TypeError("Unknown settings profile merge strategy");
  return normalizeSettings(strategy === "merge" ? deepMerge(current, parsed.settings) : parsed.settings);
}

export function normalizeManagedPolicy(input) {
  if (!plainObject(input)) return { schemaVersion: 1, defaults: {}, defaultPaths: [], lockedPaths: [] };
  const decoded = typeof input.settingsProfile === "string" ? JSON.parse(input.settingsProfile) : input;
  const defaults = plainObject(decoded.defaults) ? deepMerge(decoded.defaults) : {};
  const defaultPaths = leafPaths(defaults).slice(0, 1000);
  const lockedPaths = [...new Set((Array.isArray(decoded.lockedPaths) ? decoded.lockedPaths : [])
    .map(String).filter((path) => /^[A-Za-z][A-Za-z0-9_.]*$/.test(path) && getPath(defaults, path) !== undefined))].slice(0, 300);
  return { schemaVersion: Number(decoded.schemaVersion) || 1, defaults, defaultPaths, lockedPaths };
}

export function applyManagedPolicy(userInput, policyInput, userOverridePaths = []) {
  const policy = normalizeManagedPolicy(policyInput);
  const overrides = new Set((Array.isArray(userOverridePaths) ? userOverridePaths : []).filter((path) => policy.defaultPaths.includes(path)));
  const resolved = deepMerge(DEFAULT_SETTINGS, plainObject(userInput) ? userInput : {});
  for (const path of policy.defaultPaths) {
    if (isLocked(path, policy.lockedPaths) || !overrides.has(path)) setPath(resolved, path, getPath(policy.defaults, path));
  }
  for (const path of policy.lockedPaths) setPath(resolved, path, getPath(policy.defaults, path));
  return { settings: normalizeSettings(resolved), managed: { lockedPaths: policy.lockedPaths, active: Boolean(Object.keys(policy.defaults).length) } };
}

export function prepareManagedSettingsSave(nextInput, previousInput, policyInput, previousOverridePaths = []) {
  const policy = normalizeManagedPolicy(policyInput);
  const previous = normalizeSettings(plainObject(previousInput) ? previousInput : DEFAULT_SETTINGS);
  const submitted = normalizeSettings(nextInput);
  const current = applyManagedPolicy(previous, policy, previousOverridePaths).settings;
  const managedBaseline = applyManagedPolicy(DEFAULT_SETTINGS, policy, []).settings;
  const overrides = new Set((Array.isArray(previousOverridePaths) ? previousOverridePaths : []).filter((path) => policy.defaultPaths.includes(path)));
  const persisted = deepMerge(submitted);
  for (const path of policy.defaultPaths) {
    if (isLocked(path, policy.lockedPaths)) {
      setPath(persisted, path, getPath(previous, path));
      overrides.delete(path);
      continue;
    }
    const changed = !sameValue(getPath(submitted, path), getPath(current, path));
    if (changed && sameValue(getPath(submitted, path), getPath(managedBaseline, path))) {
      overrides.delete(path);
      setPath(persisted, path, getPath(DEFAULT_SETTINGS, path) ?? getPath(previous, path));
    } else if (changed) {
      overrides.add(path);
    } else if (!overrides.has(path)) {
      setPath(persisted, path, getPath(previous, path));
    }
  }
  return { userSettings: normalizeSettings(persisted), overridePaths: [...overrides].sort() };
}
