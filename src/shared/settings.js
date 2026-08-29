import { normalizeOrigin, parseSafeExternalUrl } from "./url.js";
import { BUILTIN_FILTERS, normalizeCustomFilter } from "../siem/features/custom-filters.js";

export const SYNC_STORAGE_KEY = "apePatrolSettings";
export const LOCAL_SECRETS_KEY = "apePatrolSecrets";
export const LEGACY_SYNC_STORAGE_KEY = "siemMonkeySettings";
export const LEGACY_LOCAL_SECRETS_KEY = "siemMonkeySecrets";
export const DEFAULT_AI_SELECTED_FIELDS = Object.freeze([
  "uuid", "time", "msgid", "event_src.host", "correlation_name", "incident_id",
  "src.ip", "src.port", "dst.ip", "dst.port", "subject.account.name", "object.account.name",
  "object.process.name", "object.process.path", "object.process.cmdline", "object.process.guid",
  "object.process.parent.name", "object.process.parent.guid", "object.hash",
]);

export const BUILTIN_PROVIDERS = Object.freeze([
  { id: "virustotal-ip", name: "VirusTotal — IP", type: "ip", urlTemplate: "https://www.virustotal.com/gui/ip-address/${ip}/details", enabled: true },
  { id: "abuseipdb-ip", name: "AbuseIPDB — IP", type: "ip", urlTemplate: "https://www.abuseipdb.com/check/${ip}", enabled: true },
  { id: "opentip-ip", name: "Kaspersky OpenTIP — IP", type: "ip", urlTemplate: "https://opentip.kaspersky.com/${ip}", enabled: true },
  { id: "shodan-ip", name: "Shodan — IP", type: "ip", urlTemplate: "https://www.shodan.io/host/${ip}", enabled: true },
  { id: "greynoise-ip", name: "GreyNoise — IP", type: "ip", urlTemplate: "https://viz.greynoise.io/ip/${ip}", enabled: true },
  { id: "virustotal-hash", name: "VirusTotal — хеш", type: "hash", urlTemplate: "https://www.virustotal.com/gui/file/${hash}/detection", enabled: true },
  { id: "opentip-hash", name: "Kaspersky OpenTIP — хеш", type: "hash", urlTemplate: "https://opentip.kaspersky.com/${hash}", enabled: true },
  { id: "malwarebazaar-hash", name: "MalwareBazaar — хеш", type: "hash", urlTemplate: "https://bazaar.abuse.ch/sample/${hash}/", enabled: true },
  { id: "virustotal-domain", name: "VirusTotal — домен", type: "domain", urlTemplate: "https://www.virustotal.com/gui/domain/${domain}/details", enabled: true },
  { id: "opentip-domain", name: "Kaspersky OpenTIP — домен", type: "domain", urlTemplate: "https://opentip.kaspersky.com/${domain}", enabled: true },
  { id: "opentip-url", name: "Kaspersky OpenTIP — URL", type: "url", urlTemplate: "https://opentip.kaspersky.com/${url}", enabled: true },
  { id: "urlhaus-url", name: "URLhaus — URL", type: "url", urlTemplate: "https://urlhaus.abuse.ch/browse.php?search=${url}", enabled: true },
]);

export const DEFAULT_SETTINGS = Object.freeze({
  schemaVersion: 6,
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
    batchIoc: true,
    investigationWorkspace: true,
    ruleIntelligence: true,
  },
  iocListName: "IOCs_Value",
  process: {
    maxNodes: 1000,
    maxDepth: 64,
    seedWindowSeconds: 900,
    expansionStepSeconds: 3600,
    pageSize: 250,
    queryConcurrency: 2,
  },
  iocBatch: {
    concurrency: 2,
    maxRetries: 2,
    cacheTtlMinutes: { virustotal: 60, abuseipdb: 30, opentip: 60, threatfox: 30 },
  },
  searchScope: { mode: "default", searchSources: [], localSources: [], groupIds: [] },
  externalProviders: BUILTIN_PROVIDERS,
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
    mode: "selected",
    selectedFields: DEFAULT_AI_SELECTED_FIELDS,
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
  const type = ["ip", "hash", "domain", "url"].includes(provider.type) ? provider.type : null;
  const templateUrl = typeof provider.urlTemplate === "string"
    ? parseSafeExternalUrl(provider.urlTemplate.replace(/\$\{(?:ip|hash|domain|url)\}/g, "placeholder"))
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
    seedWindowSeconds: boundedInteger(input.process?.seedWindowSeconds, defaults.process.seedWindowSeconds, 60, 86400),
    expansionStepSeconds: boundedInteger(input.process?.expansionStepSeconds, defaults.process.expansionStepSeconds, 300, 86400),
    pageSize: boundedInteger(input.process?.pageSize, defaults.process.pageSize, 25, 1000),
    queryConcurrency: boundedInteger(input.process?.queryConcurrency, defaults.process.queryConcurrency, 1, 4),
  };
  const aiMode = ["selected", "allowlist", "redacted", "full"].includes(input.ai?.mode) ? input.ai.mode : defaults.ai.mode;
  const inputProviders = Array.isArray(input.externalProviders) ? input.externalProviders.map(normalizeProvider).filter(Boolean) : [];
  const providerById = new Map(inputProviders.map((provider) => [provider.id, provider]));
  const builtinProviderIds = new Set(BUILTIN_PROVIDERS.map((provider) => provider.id));
  const providers = [
    ...BUILTIN_PROVIDERS.map((provider) => normalizeProvider({ ...provider, enabled: providerById.get(provider.id)?.enabled ?? provider.enabled })),
    ...inputProviders.filter((provider) => !builtinProviderIds.has(provider.id)),
  ];
  const inputFilters = Array.isArray(input.customFilters) ? input.customFilters.map(normalizeCustomFilter).filter(Boolean) : [];
  const inputById = new Map(inputFilters.map((filter) => [filter.id, filter]));
  const builtinIds = new Set(BUILTIN_FILTERS.map((filter) => filter.id));
  const customFilters = [
    ...BUILTIN_FILTERS.map((filter) => normalizeCustomFilter({ ...filter, enabled: inputById.get(filter.id)?.enabled ?? filter.enabled })),
    ...inputFilters.filter((filter) => !builtinIds.has(filter.id)),
  ];
  const fieldAliases = normalizeFieldAliases(input.fieldAliases ?? defaults.fieldAliases);
  return {
    ...defaults,
    schemaVersion: 6,
    instances,
    features,
    iocListName: String(input.iocListName || defaults.iocListName).slice(0, 120),
    process,
    iocBatch: {
      concurrency: boundedInteger(input.iocBatch?.concurrency, defaults.iocBatch.concurrency, 1, 4),
      maxRetries: boundedInteger(input.iocBatch?.maxRetries, defaults.iocBatch.maxRetries, 0, 4),
      cacheTtlMinutes: Object.fromEntries(Object.entries(defaults.iocBatch.cacheTtlMinutes).map(([provider, fallback]) => [
        provider,
        boundedInteger(input.iocBatch?.cacheTtlMinutes?.[provider], fallback, 1, 10080),
      ])),
    },
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
      selectedFields: Array.isArray(input.ai?.selectedFields)
        ? input.ai.selectedFields.map(String)
        : Number(input.schemaVersion ?? 0) < 5 && input.ai?.mode === "selected" && Array.isArray(input.ai?.allowFields)
          ? input.ai.allowFields.map(String)
          : defaults.ai.selectedFields,
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
    abuseIpDbApiKey: typeof input?.abuseIpDbApiKey === "string" ? input.abuseIpDbApiKey.trim() : "",
    openTipApiKey: typeof input?.openTipApiKey === "string" ? input.openTipApiKey.trim() : "",
    threatFoxApiKey: typeof input?.threatFoxApiKey === "string" ? input.threatFoxApiKey.trim() : "",
    llmApiKey: typeof input?.llmApiKey === "string" ? input.llmApiKey.trim() : "",
  };
}
