import { DEFAULT_SETTINGS, normalizeProvider } from "../shared/settings.js";
import { normalizeOrigin, originPattern, parseSafeExternalUrl } from "../shared/url.js";

const state = { settings: structuredClone(DEFAULT_SETTINGS), secretStatus: {} };
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
      if (!confirm(`Remove SiemMonkey access to ${origin}? Instance-specific registration and cache will be removed.`)) return;
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
  byId("max-concurrency").value = state.settings.process.maxConcurrentRequests;
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
  byId("ai-allow").value = state.settings.ai.allowFields.join("\n");
  byId("ai-deny").value = state.settings.ai.denyFields.join("\n");
  byId("debug-logging").checked = state.settings.debugLogging;
  byId("vt-status").textContent = state.secretStatus.virusTotal ? "An API key is stored locally. Enter a new value only to replace it." : "No API key stored.";
  byId("ai-status").textContent = state.secretStatus.llm ? "An API key is stored locally. Enter a new value only to replace it." : "No API key stored.";
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

async function requestExternalPermissions(origins) {
  const unique = [...new Set(origins.filter(Boolean))];
  if (unique.length && !await browser.permissions.request({ origins: unique })) return false;
  try {
    return await browser.permissions.request({ data_collection: ["websiteContent", "authenticationInfo"] });
  } catch {
    return false;
  }
}

function collectSettings() {
  const settings = structuredClone(state.settings);
  settings.features = Object.fromEntries(featureIds.map((name) => [name, byId(`feature-${name}`).checked]));
  settings.iocListName = byId("ioc-list-name").value.trim();
  settings.process = { maxNodes: Number(byId("max-nodes").value), maxDepth: Number(byId("max-depth").value), maxConcurrentRequests: Number(byId("max-concurrency").value) };
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
    maxBytes: Number(byId("ai-max-bytes").value), allowFields: lines(byId("ai-allow").value), denyFields: lines(byId("ai-deny").value),
  };
  settings.debugLogging = byId("debug-logging").checked;
  return settings;
}

async function save() {
  const settings = collectSettings();
  const vtKey = byId("vt-api-key").value.trim();
  const llmKey = byId("ai-api-key").value.trim();
  const origins = [];
  if (vtKey) origins.push("https://www.virustotal.com/*");
  if (settings.features.aiAssistant) {
    const endpoint = parseSafeExternalUrl(settings.ai.endpoint);
    if (!endpoint) throw new Error("AI assistant requires a safe HTTP(S) endpoint");
    origins.push(`${endpoint.origin}/*`);
  }
  if ((vtKey || settings.features.aiAssistant) && !await requestExternalPermissions(origins)) {
    throw new Error("Firefox data-transmission or endpoint permission was not granted; external provider was not enabled");
  }
  const settingsResponse = await browser.runtime.sendMessage({ type: "settings:save", settings });
  if (!settingsResponse.ok) throw new Error(settingsResponse.error);
  const secrets = {};
  if (vtKey) secrets.virusTotalApiKey = vtKey;
  if (llmKey) secrets.llmApiKey = llmKey;
  if (Object.keys(secrets).length) {
    const secretResponse = await browser.runtime.sendMessage({ type: "secrets:save", secrets });
    if (!secretResponse.ok) throw new Error(secretResponse.error);
  }
  state.settings = settingsResponse.settings;
  byId("vt-api-key").value = "";
  byId("ai-api-key").value = "";
  setStatus("Settings saved. Dynamic SIEM registrations refreshed.");
}

byId("add-instance").addEventListener("click", () => addInstance().catch((error) => setStatus(error.message, true)));
byId("save").addEventListener("click", () => save().catch((error) => setStatus(error.message, true)));

Promise.all([
  browser.runtime.sendMessage({ type: "settings:get" }),
  browser.runtime.sendMessage({ type: "secrets:get-status" }),
]).then(([settingsResponse, secretResponse]) => {
  state.settings = settingsResponse.settings;
  state.secretStatus = secretResponse.configured;
  renderSettings();
}).catch((error) => setStatus(error.message, true));
