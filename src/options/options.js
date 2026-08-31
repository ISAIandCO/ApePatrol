import { DEFAULT_SETTINGS, normalizeProvider } from "../shared/settings.js";
import { normalizeOrigin, originPattern, parseSafeExternalUrl } from "../shared/url.js";
import { exportSettingsProfile, importSettingsProfile } from "../shared/profiles.js";

const state = { settings: structuredClone(DEFAULT_SETTINGS), managed: { active: false, lockedPaths: [] }, secretStatus: {}, permissionStatus: { dataCollection: [], endpointAccess: {} } };
const IOC_API_ORIGINS = Object.freeze({
  virustotal: "https://www.virustotal.com/*",
  abuseipdb: "https://api.abuseipdb.com/*",
  opentip: "https://opentip.kaspersky.com/*",
  threatfox: "https://threatfox-api.abuse.ch/*",
});
const byId = (id) => document.getElementById(id);
const featureIds = Object.keys(DEFAULT_SETTINGS.features);
const lines = (value) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
const SETTING_PATHS = Object.freeze({
  "instance-origin": "instances", "add-instance": "instances", "ioc-list-name": "iocListName",
  "max-nodes": "process.maxNodes", "max-depth": "process.maxDepth", "process-seed-window": "process.seedWindowSeconds",
  "process-expansion-step": "process.expansionStepSeconds", "process-page-size": "process.pageSize", "process-query-concurrency": "process.queryConcurrency",
  "search-mode": "searchScope.mode", "search-sources": "searchScope.searchSources", "local-sources": "searchScope.localSources", "group-ids": "searchScope.groupIds",
  providers: "externalProviders", "custom-filters": "customFilters", "field-aliases": "fieldAliases",
  "batch-concurrency": "iocBatch.concurrency", "batch-retries": "iocBatch.maxRetries",
  "batch-ttl-virustotal": "iocBatch.cacheTtlMinutes.virustotal", "batch-ttl-abuseipdb": "iocBatch.cacheTtlMinutes.abuseipdb",
  "batch-ttl-opentip": "iocBatch.cacheTtlMinutes.opentip", "batch-ttl-threatfox": "iocBatch.cacheTtlMinutes.threatfox",
  "ai-endpoint": "ai.endpoint", "ai-model": "ai.model", "ai-mode": "ai.mode", "ai-max-bytes": "ai.maxBytes",
  "ai-selected": "ai.selectedFields", "ai-allow": "ai.allowFields", "ai-deny": "ai.denyFields", "debug-logging": "debugLogging",
});

function isManagedPath(path) { return state.managed.lockedPaths.some((locked) => path === locked || path.startsWith(`${locked}.`)); }

function applyManagedLocks() {
  for (const name of featureIds) byId(`feature-${name}`).disabled = isManagedPath(`features.${name}`);
  for (const [id, path] of Object.entries(SETTING_PATHS)) if (byId(id)) byId(id).disabled = isManagedPath(path);
  document.querySelectorAll("#instances button").forEach((button) => { button.disabled = isManagedPath("instances"); });
  byId("managed-status").textContent = state.managed.active
    ? `Managed policy active. Locked: ${state.managed.lockedPaths.join(", ") || "none (defaults only)"}.`
    : "Managed policy is not active.";
}

function setStatus(message, isError = false) {
  byId("status").textContent = message;
  byId("status").style.color = isError ? "#b62929" : "inherit";
}

function renderInstances() {
  const list = byId("instances");
  list.replaceChildren();
  for (const origin of state.settings.instances) {
    const item = document.createElement("li");
    const text = document.createElement("span"); text.textContent = origin;
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Remove access";
    remove.addEventListener("click", async () => {
      if (!confirm(`Remove ApePatrol access to ${origin}? Instance-specific registration and cache will be removed.`)) return;
      state.settings.instances = state.settings.instances.filter((itemOrigin) => itemOrigin !== origin);
      await browser.permissions.remove({ origins: [originPattern(origin)] });
      await browser.runtime.sendMessage({ type: "settings:save", settings: state.settings });
      renderInstances();
      setStatus("Instance removed.");
    });
    item.append(text, remove);
    list.append(item);
  }
  if (!state.settings.instances.length) {
    const empty = document.createElement("li"); empty.textContent = "No SIEM origins configured."; list.append(empty);
  }
}

function renderSettings() {
  renderInstances();
  for (const name of featureIds) byId(`feature-${name}`).checked = state.settings.features[name];
  byId("ioc-list-name").value = state.settings.iocListName;
  byId("max-nodes").value = state.settings.process.maxNodes;
  byId("max-depth").value = state.settings.process.maxDepth;
  byId("process-seed-window").value = state.settings.process.seedWindowSeconds;
  byId("process-expansion-step").value = state.settings.process.expansionStepSeconds;
  byId("process-page-size").value = state.settings.process.pageSize;
  byId("process-query-concurrency").value = state.settings.process.queryConcurrency;
  byId("search-mode").value = state.settings.searchScope.mode;
  byId("search-sources").value = state.settings.searchScope.searchSources.join("\n");
  byId("local-sources").value = state.settings.searchScope.localSources.join("\n");
  byId("group-ids").value = state.settings.searchScope.groupIds.join("\n");
  byId("providers").value = JSON.stringify(state.settings.externalProviders, null, 2);
  byId("custom-filters").value = JSON.stringify(state.settings.customFilters, null, 2);
  byId("field-aliases").value = JSON.stringify(state.settings.fieldAliases, null, 2);
  byId("ai-endpoint").value = state.settings.ai.endpoint;
  byId("ai-model").value = state.settings.ai.model;
  byId("ai-mode").value = state.settings.ai.mode;
  byId("ai-max-bytes").value = state.settings.ai.maxBytes;
  byId("ai-selected").value = state.settings.ai.selectedFields.join("\n");
  byId("ai-allow").value = state.settings.ai.allowFields.join("\n");
  byId("ai-deny").value = state.settings.ai.denyFields.join("\n");
  byId("batch-concurrency").value = state.settings.iocBatch.concurrency;
  byId("batch-retries").value = state.settings.iocBatch.maxRetries;
  for (const provider of Object.keys(IOC_API_ORIGINS)) byId(`batch-ttl-${provider}`).value = state.settings.iocBatch.cacheTtlMinutes[provider];
  byId("debug-logging").checked = state.settings.debugLogging;
  byId("vt-status").textContent = state.secretStatus.virusTotal ? "An API key is stored locally. Enter a new value only to replace it." : "No API key stored.";
  byId("abuseipdb-status").textContent = state.secretStatus.abuseIpDb ? "API-ключ сохранён локально." : "API-ключ не задан.";
  byId("opentip-status").textContent = state.secretStatus.openTip ? "API-токен сохранён локально." : "API-токен не задан.";
  byId("threatfox-status").textContent = state.secretStatus.threatFox ? "Auth-Key сохранён локально." : "Auth-Key не задан.";
  byId("ai-status").textContent = state.secretStatus.llm ? "An API key is stored locally. Enter a new value only to replace it." : "No API key stored.";
  const dataGranted = ["websiteContent", "authenticationInfo"].every((type) => state.permissionStatus.dataCollection.includes(type));
  byId("data-permission-status").textContent = dataGranted ? "Разрешение Firefox выдано." : "Разрешение Firefox не выдано.";
  for (const provider of Object.keys(IOC_API_ORIGINS)) {
    const button = byId(`grant-${provider}`);
    button.textContent = state.permissionStatus.endpointAccess[provider] ? "Доступ к API выдан" : "Разрешить доступ к API";
  }
  applyManagedLocks();
}

async function addInstance() {
  const origin = normalizeOrigin(byId("instance-origin").value.trim());
  if (!origin) throw new Error("Enter an HTTP(S) origin without a path, query or credentials");
  const granted = await browser.permissions.request({ origins: [originPattern(origin)] });
  if (!granted) throw new Error("Firefox did not grant access to this origin");
  state.settings.instances = [...new Set([...state.settings.instances, origin])];
  const response = await browser.runtime.sendMessage({ type: "settings:save", settings: state.settings });
  if (!response.ok) throw new Error(response.error);
  byId("instance-origin").value = "";
  renderInstances();
  setStatus(`Access granted only to ${origin}.`);
}

async function refreshPermissionStatus() {
  const response = await browser.runtime.sendMessage({ type: "enrichment:permission-status" });
  if (!response?.ok) throw new Error(response?.error ?? "Не удалось прочитать разрешения Firefox");
  state.permissionStatus = response;
  renderSettings();
}

async function grantDataPermission() {
  const granted = await browser.permissions.request({ data_collection: ["websiteContent", "authenticationInfo"] });
  if (!granted) throw new Error("Firefox не выдал разрешение на передачу IOC и API-ключей");
  await refreshPermissionStatus();
  setStatus("Разрешение на передачу IOC внешним провайдерам выдано.");
}

async function grantProviderAccess(provider) {
  const origin = IOC_API_ORIGINS[provider];
  if (!origin || !await browser.permissions.request({ origins: [origin] })) throw new Error("Firefox не выдал доступ к API провайдера");
  await refreshPermissionStatus();
  setStatus("Доступ к API провайдера выдан.");
}

async function grantAiEndpoint() {
  const endpoint = parseSafeExternalUrl(byId("ai-endpoint").value.trim());
  if (!endpoint) throw new Error("Сначала укажите корректный HTTPS endpoint AI");
  if (!await browser.permissions.request({ origins: [`${endpoint.origin}/*`] })) throw new Error("Firefox не выдал доступ к AI endpoint");
  setStatus(`Доступ к ${endpoint.origin} выдан.`);
}

function collectSettings() {
  const settings = structuredClone(state.settings);
  settings.features = Object.fromEntries(featureIds.map((name) => [name, byId(`feature-${name}`).checked]));
  settings.iocListName = byId("ioc-list-name").value.trim();
  settings.process = {
    maxNodes: Number(byId("max-nodes").value), maxDepth: Number(byId("max-depth").value),
    seedWindowSeconds: Number(byId("process-seed-window").value), expansionStepSeconds: Number(byId("process-expansion-step").value),
    pageSize: Number(byId("process-page-size").value), queryConcurrency: Number(byId("process-query-concurrency").value),
  };
  settings.iocBatch = {
    concurrency: Number(byId("batch-concurrency").value), maxRetries: Number(byId("batch-retries").value),
    cacheTtlMinutes: Object.fromEntries(Object.keys(IOC_API_ORIGINS).map((provider) => [provider, Number(byId(`batch-ttl-${provider}`).value)])),
  };
  settings.searchScope = {
    mode: byId("search-mode").value,
    searchSources: lines(byId("search-sources").value),
    localSources: lines(byId("local-sources").value),
    groupIds: lines(byId("group-ids").value),
  };
  let parsedProviders;
  try { parsedProviders = JSON.parse(byId("providers").value || "[]"); } catch { throw new Error("External providers JSON is invalid"); }
  if (!Array.isArray(parsedProviders)) throw new Error("External providers must be a JSON array");
  settings.externalProviders = parsedProviders.map(normalizeProvider).filter(Boolean);
  if (settings.externalProviders.length !== parsedProviders.length) throw new Error("One or more external providers has an unsafe URL or invalid type");
  let parsedFilters;
  try { parsedFilters = JSON.parse(byId("custom-filters").value || "[]"); } catch { throw new Error("Custom filters JSON is invalid"); }
  if (!Array.isArray(parsedFilters)) throw new Error("Custom filters must be a JSON array");
  settings.customFilters = parsedFilters;
  try { settings.fieldAliases = JSON.parse(byId("field-aliases").value || "{}"); } catch { throw new Error("Field aliases JSON is invalid"); }
  settings.ai = {
    endpoint: byId("ai-endpoint").value.trim(), model: byId("ai-model").value.trim(), mode: byId("ai-mode").value,
    maxBytes: Number(byId("ai-max-bytes").value), selectedFields: lines(byId("ai-selected").value),
    allowFields: lines(byId("ai-allow").value), denyFields: lines(byId("ai-deny").value),
  };
  settings.debugLogging = byId("debug-logging").checked;
  return settings;
}

async function save() {
  const settings = collectSettings();
  const secrets = collectSecrets();
  const settingsResponse = await browser.runtime.sendMessage({ type: "settings:save", settings });
  if (!settingsResponse.ok) throw new Error(settingsResponse.error);
  if (Object.keys(secrets).length) await saveSecrets(secrets);
  state.settings = settingsResponse.settings;
  setStatus("Settings saved. Dynamic SIEM registrations refreshed.");
}

function collectSecrets() {
  const vtKey = byId("vt-api-key").value.trim();
  const abuseIpDbKey = byId("abuseipdb-api-key").value.trim();
  const openTipKey = byId("opentip-api-key").value.trim();
  const threatFoxKey = byId("threatfox-api-key").value.trim();
  const llmKey = byId("ai-api-key").value.trim();
  const secrets = {};
  if (vtKey) secrets.virusTotalApiKey = vtKey;
  if (abuseIpDbKey) secrets.abuseIpDbApiKey = abuseIpDbKey;
  if (openTipKey) secrets.openTipApiKey = openTipKey;
  if (threatFoxKey) secrets.threatFoxApiKey = threatFoxKey;
  if (llmKey) secrets.llmApiKey = llmKey;
  return secrets;
}

async function saveSecrets(secrets = collectSecrets()) {
  if (!Object.keys(secrets).length) throw new Error("Введите хотя бы один API-ключ");
  const secretResponse = await browser.runtime.sendMessage({ type: "secrets:save", secrets });
  if (!secretResponse.ok) throw new Error(secretResponse.error);
  byId("vt-api-key").value = "";
  byId("abuseipdb-api-key").value = "";
  byId("opentip-api-key").value = "";
  byId("threatfox-api-key").value = "";
  byId("ai-api-key").value = "";
  state.secretStatus = { ...state.secretStatus, virusTotal: state.secretStatus.virusTotal || Boolean(secrets.virusTotalApiKey), abuseIpDb: state.secretStatus.abuseIpDb || Boolean(secrets.abuseIpDbApiKey), openTip: state.secretStatus.openTip || Boolean(secrets.openTipApiKey), threatFox: state.secretStatus.threatFox || Boolean(secrets.threatFoxApiKey), llm: state.secretStatus.llm || Boolean(secrets.llmApiKey) };
  byId("vt-status").textContent = state.secretStatus.virusTotal ? "An API key is stored locally. Enter a new value only to replace it." : "No API key stored.";
  byId("abuseipdb-status").textContent = state.secretStatus.abuseIpDb ? "API-ключ сохранён локально." : "API-ключ не задан.";
  byId("opentip-status").textContent = state.secretStatus.openTip ? "API-токен сохранён локально." : "API-токен не задан.";
  byId("threatfox-status").textContent = state.secretStatus.threatFox ? "Auth-Key сохранён локально." : "Auth-Key не задан.";
  byId("ai-status").textContent = state.secretStatus.llm ? "An API key is stored locally. Enter a new value only to replace it." : "No API key stored.";
}

async function exportProfile() {
  const profile = exportSettingsProfile(collectSettings());
  const url = `data:application/json;charset=utf-8,${encodeURIComponent(`${JSON.stringify(profile, null, 2)}\n`)}`;
  await browser.downloads.download({ url, filename: `apepatrol-settings-profile-v${profile.schemaVersion}.json`, saveAs: true });
  setStatus("Non-secret settings profile exported.");
}

async function importProfile() {
  const file = byId("profile-file").files?.[0];
  if (!file) throw new Error("Choose a settings profile JSON file");
  const settings = importSettingsProfile(state.settings, await file.text(), byId("profile-strategy").value);
  if (!confirm("Profile validation passed. Apply its non-secret settings now? Managed locks will still take precedence.")) return;
  const saved = await browser.runtime.sendMessage({ type: "settings:save", settings });
  if (!saved?.ok) throw new Error(saved?.error ?? "Profile import failed");
  const refreshed = await browser.runtime.sendMessage({ type: "settings:get" });
  state.settings = refreshed.settings;
  state.managed = refreshed.managed ?? state.managed;
  renderSettings();
  setStatus("Settings profile imported and normalized.");
}

byId("add-instance").addEventListener("click", () => addInstance().catch((error) => setStatus(error.message, true)));
byId("save").addEventListener("click", () => save().catch((error) => setStatus(error.message, true)));
byId("save-ioc-keys").addEventListener("click", () => saveSecrets().then(() => setStatus("API-ключи сохранены локально.")).catch((error) => setStatus(error.message, true)));
byId("grant-data-permission").addEventListener("click", () => grantDataPermission().catch((error) => setStatus(error.message, true)));
for (const provider of Object.keys(IOC_API_ORIGINS)) byId(`grant-${provider}`).addEventListener("click", () => grantProviderAccess(provider).catch((error) => setStatus(error.message, true)));
byId("grant-ai-endpoint").addEventListener("click", () => grantAiEndpoint().catch((error) => setStatus(error.message, true)));
byId("profile-export").addEventListener("click", () => exportProfile().catch((error) => setStatus(error.message, true)));
byId("profile-import").addEventListener("click", () => importProfile().catch((error) => setStatus(error.message, true)));

Promise.all([
  browser.runtime.sendMessage({ type: "settings:get" }),
  browser.runtime.sendMessage({ type: "secrets:get-status" }),
  browser.runtime.sendMessage({ type: "enrichment:permission-status" }),
]).then(([settingsResponse, secretResponse, permissionResponse]) => {
  state.settings = settingsResponse.settings;
  state.managed = settingsResponse.managed ?? state.managed;
  state.secretStatus = secretResponse.configured;
  state.permissionStatus = permissionResponse;
  renderSettings();
}).catch((error) => setStatus(error.message, true));
