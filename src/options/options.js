import { DEFAULT_SETTINGS, normalizeProvider } from "../shared/settings.js";
import { normalizeOrigin, originPattern, parseSafeExternalUrl } from "../shared/url.js";

const state = { settings: structuredClone(DEFAULT_SETTINGS), secretStatus: {}, permissionStatus: { dataCollection: [], endpointAccess: {} } };
const IOC_API_ORIGINS = Object.freeze({
  virustotal: "https://www.virustotal.com/*",
  abuseipdb: "https://api.abuseipdb.com/*",
  opentip: "https://opentip.kaspersky.com/*",
  threatfox: "https://threatfox-api.abuse.ch/*",
});
const byId = (id) => document.getElementById(id);
const featureIds = Object.keys(DEFAULT_SETTINGS.features);
const lines = (value) => value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);

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
  settings.process = { maxNodes: Number(byId("max-nodes").value), maxDepth: Number(byId("max-depth").value) };
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
  const vtKey = byId("vt-api-key").value.trim();
  const abuseIpDbKey = byId("abuseipdb-api-key").value.trim();
  const openTipKey = byId("opentip-api-key").value.trim();
  const threatFoxKey = byId("threatfox-api-key").value.trim();
  const llmKey = byId("ai-api-key").value.trim();
  const settingsResponse = await browser.runtime.sendMessage({ type: "settings:save", settings });
  if (!settingsResponse.ok) throw new Error(settingsResponse.error);
  const secrets = {};
  if (vtKey) secrets.virusTotalApiKey = vtKey;
  if (abuseIpDbKey) secrets.abuseIpDbApiKey = abuseIpDbKey;
  if (openTipKey) secrets.openTipApiKey = openTipKey;
  if (threatFoxKey) secrets.threatFoxApiKey = threatFoxKey;
  if (llmKey) secrets.llmApiKey = llmKey;
  if (Object.keys(secrets).length) {
    const secretResponse = await browser.runtime.sendMessage({ type: "secrets:save", secrets });
    if (!secretResponse.ok) throw new Error(secretResponse.error);
  }
  state.settings = settingsResponse.settings;
  byId("vt-api-key").value = "";
  byId("abuseipdb-api-key").value = "";
  byId("opentip-api-key").value = "";
  byId("threatfox-api-key").value = "";
  byId("ai-api-key").value = "";
  state.secretStatus = { ...state.secretStatus, virusTotal: state.secretStatus.virusTotal || Boolean(vtKey), abuseIpDb: state.secretStatus.abuseIpDb || Boolean(abuseIpDbKey), openTip: state.secretStatus.openTip || Boolean(openTipKey), threatFox: state.secretStatus.threatFox || Boolean(threatFoxKey), llm: state.secretStatus.llm || Boolean(llmKey) };
  renderSettings();
  setStatus("Settings saved. Dynamic SIEM registrations refreshed.");
}

byId("add-instance").addEventListener("click", () => addInstance().catch((error) => setStatus(error.message, true)));
byId("save").addEventListener("click", () => save().catch((error) => setStatus(error.message, true)));
byId("grant-data-permission").addEventListener("click", () => grantDataPermission().catch((error) => setStatus(error.message, true)));
for (const provider of Object.keys(IOC_API_ORIGINS)) byId(`grant-${provider}`).addEventListener("click", () => grantProviderAccess(provider).catch((error) => setStatus(error.message, true)));
byId("grant-ai-endpoint").addEventListener("click", () => grantAiEndpoint().catch((error) => setStatus(error.message, true)));

Promise.all([
  browser.runtime.sendMessage({ type: "settings:get" }),
  browser.runtime.sendMessage({ type: "secrets:get-status" }),
  browser.runtime.sendMessage({ type: "enrichment:permission-status" }),
]).then(([settingsResponse, secretResponse, permissionResponse]) => {
  state.settings = settingsResponse.settings;
  state.secretStatus = secretResponse.configured;
  state.permissionStatus = permissionResponse;
  renderSettings();
}).catch((error) => setStatus(error.message, true));
