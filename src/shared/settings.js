import { normalizeOrigin, parseSafeExternalUrl } from "./url.js";
import { BUILTIN_FILTERS, normalizeCustomFilter } from "../siem/features/custom-filters.js";

export const SYNC_STORAGE_KEY = "siemMonkeySettings";
export const LOCAL_SECRETS_KEY = "siemMonkeySecrets";

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 3,
  instances: [],
  features: {
    eventActions: true,
    relatedEvents: true,
    processTree: true,
    incidentContext: true,
    tableListTools: true,
    addIocDescription: false,
    disableEdrIntegration: false,
    aiAssistant: false,
  },
  iocListName: "IOCs_Value",
  process: { maxNodes: 1000, maxDepth: 64, maxConcurrentRequests: 4 },
  searchScope: { mode: "default", searchSources: [], localSources: [], groupIds: [] },
  externalProviders: [],
  customFilters: BUILTIN_FILTERS,
  fieldAliases: {
    default: {
      "subject.process.cmdline": "process command line",
      "subject.process.parent.cmdline": "parent process command line"
    }
  },
  ai: {
    endpoint: "",
    model: "",
    mode: "redacted",
    allowFields: [],
    denyFields: ["password", "token", "cookie", "authorization", "api_key", "secret", "body", "text"],
    maxBytes: 64000,
  },
  debugLogging: false,
});

const cloneDefaults = () => structuredClone(DEFAULT_SETTINGS);
const bool = (value, fallback) => typeof value === "boolean" ? value : fallback;
const boundedInteger = (value, fallback, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;

export function normalizeProvider(provider, index = 0) {
  if (!provider || typeof provider !== "object") return null;
  const type = ["ip", "hash", "url"].includes(provider.type) ? provider.type : null;
  const templateUrl = typeof provider.urlTemplate === "string"
    ? parseSafeExternalUrl(provider.urlTemplate.replace(/\$\{(?:ip|hash|url)\}/g, "placeholder"))
    : null;
  if (!type || !templateUrl) return null;
  return {
    id: String(provider.id || `provider-${index}`).replace(/[^a-z0-9_-]/gi, "-").slice(0, 64),
    name: String(provider.name || `Provider ${index + 1}`).slice(0, 80),
    type,
    urlTemplate: provider.urlTemplate,
    allowPrivate: Boolean(provider.allowPrivate),
    enabled: provider.enabled !== false,
  };
}

export function normalizeSettings(input) {
  const defaults = cloneDefaults();
  if (!input || typeof input !== "object") return defaults;
  const instances = Array.isArray(input.instances)
    ? [...new Set(input.instances.map((entry) => normalizeOrigin(typeof entry === "string" ? entry : entry?.origin)).filter(Boolean))]
    : [];
  const sourceFeatures = input.features && typeof input.features === "object" ? input.features : {};
  const features = Object.fromEntries(Object.entries(defaults.features).map(([key, value]) => [key, bool(sourceFeatures[key], value)]));
  const process = {
    maxNodes: boundedInteger(input.process?.maxNodes, defaults.process.maxNodes, 1, 10000),
    maxDepth: boundedInteger(input.process?.maxDepth, defaults.process.maxDepth, 1, 256),
    maxConcurrentRequests: boundedInteger(input.process?.maxConcurrentRequests, defaults.process.maxConcurrentRequests, 1, 16),
  };
  const aiMode = ["selected", "redacted", "full"].includes(input.ai?.mode) ? input.ai.mode : defaults.ai.mode;
  const providers = Array.isArray(input.externalProviders)
    ? input.externalProviders.map(normalizeProvider).filter(Boolean)
    : [];
  const customFilters = Array.isArray(input.customFilters)
    ? input.customFilters.map(normalizeCustomFilter).filter(Boolean)
    : structuredClone(BUILTIN_FILTERS);
  const fieldAliases = normalizeFieldAliases(input.fieldAliases ?? defaults.fieldAliases);
  return {
    ...defaults,
    schemaVersion: 3,
    instances,
    features,
    iocListName: String(input.iocListName || defaults.iocListName).slice(0, 120),
    process,
    searchScope: {
      mode: ["default", "selected", "all"].includes(input.searchScope?.mode) ? input.searchScope.mode : "default",
      searchSources: Array.isArray(input.searchScope?.searchSources) ? input.searchScope.searchSources.map(String) : [],
      localSources: Array.isArray(input.searchScope?.localSources) ? input.searchScope.localSources.map(String) : [],
      groupIds: Array.isArray(input.searchScope?.groupIds) ? input.searchScope.groupIds.map(String) : [],
    },
    externalProviders: providers,
    customFilters,
    fieldAliases,
    ai: {
      endpoint: parseSafeExternalUrl(input.ai?.endpoint)?.href ?? "",
      model: String(input.ai?.model || "").slice(0, 120),
      mode: aiMode,
      allowFields: Array.isArray(input.ai?.allowFields) ? input.ai.allowFields.map(String) : [],
      denyFields: Array.isArray(input.ai?.denyFields) ? input.ai.denyFields.map(String) : defaults.ai.denyFields,
      maxBytes: boundedInteger(input.ai?.maxBytes, defaults.ai.maxBytes, 1024, 200000),
    },
    debugLogging: bool(input.debugLogging, false),
  };
}

function normalizeFieldAliases(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [rule, aliases] of Object.entries(value).slice(0, 200)) {
    if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) continue;
    result[String(rule).slice(0, 160)] = Object.fromEntries(Object.entries(aliases).slice(0, 300)
      .filter(([field, alias]) => /^[A-Za-z_][A-Za-z0-9_.]*$/.test(field) && typeof alias === "string")
      .map(([field, alias]) => [field, alias.slice(0, 160)]));
  }
  return result;
}

export function migrateLegacySettings(legacy) {
  const options = legacy?.options && typeof legacy.options === "object" ? legacy.options : {};
  const settings = cloneDefaults();
  settings.features.addIocDescription = Boolean(options.add_input_for_IOCs_description);
  settings.features.disableEdrIntegration = Boolean(options.disable_edr_integration);
  settings.features.aiAssistant = Boolean(options.enable_sec_ai_assistant);
  settings.ai.endpoint = options.llm_api_endpoint ?? "";
  settings.ai.model = options.llm_api_model_name ?? "";
  settings.externalProviders = [
    ...(Array.isArray(options.iplinks) ? options.iplinks.map((item, index) => ({
      id: `legacy-ip-${index}`,
      name: item.name,
      type: "ip",
      urlTemplate: item.template,
      allowPrivate: Boolean(item.local),
      enabled: true,
    })) : []),
    ...(Array.isArray(options.hashlinks) ? options.hashlinks.map((item, index) => ({
      id: `legacy-hash-${index}`,
      name: item.name,
      type: "hash",
      urlTemplate: item.template,
      allowPrivate: false,
      enabled: true,
    })) : []),
  ];
  return {
    settings: normalizeSettings(settings),
    secrets: {
      virusTotalApiKey: String(options.vt_api_key ?? options["vt-api-key"] ?? ""),
      llmApiKey: String(options.llm_api_key ?? ""),
    },
  };
}

export function normalizeSecrets(input) {
  return {
    virusTotalApiKey: typeof input?.virusTotalApiKey === "string" ? input.virusTotalApiKey.trim() : "",
    llmApiKey: typeof input?.llmApiKey === "string" ? input.llmApiKey.trim() : "",
  };
}
