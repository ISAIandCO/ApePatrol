import { loadSecrets, loadSettings, saveSecrets, saveSettings } from "../shared/storage.js";
import { normalizeOrigin, originPattern, parseSafeExternalUrl } from "../shared/url.js";
import { isExtensionPageSender } from "../shared/runtime-sender.js";
import { proxySiemApiRequest } from "./siem-proxy.js";
import { IOC_API_PROVIDERS, lookupIoc } from "./ioc-enrichment.js";
import { setIocDescription } from "./ioc-description.js";
import { applyTableListMutation } from "./table-list.js";
import { deleteGraphSnapshot, getGraphSnapshot, saveGraphSnapshot } from "./graph-snapshots.js";
import { prepareAiRequest } from "../shared/ai-payload.js";
import { ERROR_CODES, normalizeError } from "../shared/errors.js";

const CONTENT_PREFIX = "apepatrol-content-";
const LEGACY_BRIDGE_PREFIX = "apepatrol-bridge-";

async function refreshRegistrations() {
  const settings = await loadSettings();
  const registered = await browser.scripting.getRegisteredContentScripts();
  const ours = registered.filter((script) => script.id.startsWith(CONTENT_PREFIX) || script.id.startsWith(LEGACY_BRIDGE_PREFIX));
  if (ours.length) await browser.scripting.unregisterContentScripts({ ids: ours.map((script) => script.id) });
  const scripts = [];
  let index = 0;
  for (const origin of settings.instances) {
    const pattern = originPattern(origin);
    if (!pattern || !await browser.permissions.contains({ origins: [pattern] })) continue;
    scripts.push({
      id: `${CONTENT_PREFIX}${index}`,
      matches: [pattern],
      js: ["content.js"],
      css: ["content.css"],
      allFrames: false,
      runAt: "document_idle",
      persistAcrossSessions: true,
      world: "ISOLATED",
    });
    index += 1;
  }
  if (scripts.length) await browser.scripting.registerContentScripts(scripts);
  return scripts.length;
}

async function senderIsConfiguredSiem(sender) {
  if (!sender.tab?.url) return false;
  const origin = normalizeOrigin(new URL(sender.tab.url).origin);
  const settings = await loadSettings();
  return Boolean(origin && settings.instances.includes(origin));
}

function assertExtensionPage(sender) {
  if (!isExtensionPageSender(sender, browser.runtime.getURL("/"))) {
    throw new Error("This action is restricted to extension pages");
  }
}

async function hasDataPermission(types) {
  try {
    const permissions = await browser.permissions.getAll();
    return Array.isArray(permissions.data_collection) && types.every((type) => permissions.data_collection.includes(type));
  } catch {
    return false;
  }
}

async function llmRequest(message) {
  if (message.confirmed !== true) throw new Error("Operator confirmation is required");
  const [settings, secrets] = await Promise.all([loadSettings(), loadSecrets()]);
  if (!settings.features.aiAssistant) throw new Error("AI assistant is disabled");
  const endpoint = parseSafeExternalUrl(settings.ai.endpoint);
  if (!endpoint || !settings.ai.model || !secrets.llmApiKey) throw new Error("AI endpoint, model, or key is not configured");
  if (!await browser.permissions.contains({ origins: [`${endpoint.origin}/*`] })) throw new Error("AI endpoint host permission is missing");
  if (!await hasDataPermission(["websiteContent", "authenticationInfo"])) throw new Error("Firefox data-collection permission is missing");
  const prepared = await prepareAiRequest(message.event, settings.ai, { selectedFields: message.selectedFields });
  if (!message.previewHash || message.previewHash !== prepared.hash) throw new Error("AI preview is stale; review the final payload again");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(endpoint.href, {
      method: "POST",
      headers: { Authorization: `Bearer ${secrets.llmApiKey}`, "Content-Type": "application/json" },
      body: prepared.serialized,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`LLM endpoint returned HTTP ${response.status}`);
    const body = await response.json();
    const content = body?.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Unexpected LLM response schema");
    return { content: content.slice(0, 100000), sentFields: prepared.sentFields, bytes: prepared.byteLength, endpoint: endpoint.origin };
  } finally {
    clearTimeout(timer);
  }
}

browser.runtime.onInstalled.addListener(() => refreshRegistrations().catch(console.error));
browser.runtime.onStartup.addListener(() => refreshRegistrations().catch(console.error));
browser.permissions.onAdded.addListener(() => refreshRegistrations().catch(console.error));
browser.permissions.onRemoved.addListener(() => refreshRegistrations().catch(console.error));

browser.runtime.onMessage.addListener(async (message, sender) => {
  try {
    switch (message?.type) {
      case "settings:get":
        return { ok: true, settings: await loadSettings() };
      case "settings:save":
        assertExtensionPage(sender);
        return { ok: true, settings: await saveSettings(message.settings), registrations: await refreshRegistrations() };
      case "secrets:get-status": {
        assertExtensionPage(sender);
        const secrets = await loadSecrets();
        return { ok: true, configured: {
          virusTotal: Boolean(secrets.virusTotalApiKey),
          abuseIpDb: Boolean(secrets.abuseIpDbApiKey),
          openTip: Boolean(secrets.openTipApiKey),
          threatFox: Boolean(secrets.threatFoxApiKey),
          llm: Boolean(secrets.llmApiKey),
        } };
      }
      case "secrets:save":
        assertExtensionPage(sender);
        await saveSecrets({ ...(await loadSecrets()), ...message.secrets });
        return { ok: true };
      case "registrations:refresh":
        assertExtensionPage(sender);
        return { ok: true, count: await refreshRegistrations() };
      case "graph:snapshot:save":
        assertExtensionPage(sender);
        return { ok: true, snapshot: await saveGraphSnapshot(message.snapshot) };
      case "graph:snapshot:get":
        assertExtensionPage(sender);
        return { ok: true, snapshot: await getGraphSnapshot(message.id) };
      case "graph:snapshot:delete":
        assertExtensionPage(sender);
        return { ok: true, deleted: await deleteGraphSnapshot(message.id) };
      case "tabs:open": {
        const url = parseSafeExternalUrl(message.url);
        if (!url) throw new Error("Unsafe URL was rejected");
        await browser.tabs.create({ url: url.href });
        return { ok: true };
      }
      case "enrichment:permission-status": {
        assertExtensionPage(sender);
        const all = await browser.permissions.getAll();
        const endpointAccess = Object.fromEntries(await Promise.all(Object.entries(IOC_API_PROVIDERS).map(async ([id, provider]) => [id, await browser.permissions.contains({ origins: [provider.origin] })])));
        return { ok: true, dataCollection: all.data_collection ?? [], endpointAccess };
      }
      case "enrichment:ioc": {
        if (!isExtensionPageSender(sender, browser.runtime.getURL("/")) && !await senderIsConfiguredSiem(sender)) throw new Error("IOC enrichment is restricted to ApePatrol and configured SIEM pages");
        const provider = IOC_API_PROVIDERS[message.provider];
        if (!provider) throw new Error("Unknown IOC provider");
        if (!await hasDataPermission(["websiteContent", "authenticationInfo"])) throw new Error("Разрешение Firefox на передачу IOC и API-ключа не выдано — откройте настройки ApePatrol");
        if (!await browser.permissions.contains({ origins: [provider.origin] })) throw new Error(`Доступ к API ${provider.name} не выдан — откройте настройки ApePatrol`);
        return { ok: true, result: await lookupIoc(message.provider, message.ioc, await loadSecrets()) };
      }
      case "enrichment:llm":
        assertExtensionPage(sender);
        return { ok: true, result: await llmRequest(message) };
      case "ai:preview": {
        assertExtensionPage(sender);
        const settings = await loadSettings();
        if (!settings.features.aiAssistant) throw new Error("AI assistant is disabled");
        const endpoint = parseSafeExternalUrl(settings.ai.endpoint);
        if (!endpoint || !settings.ai.model) throw new Error("AI endpoint or model is not configured");
        return { ok: true, endpoint: endpoint.origin, preview: await prepareAiRequest(message.event, settings.ai, { selectedFields: message.selectedFields }) };
      }
      case "content:ready":
        if (!await senderIsConfiguredSiem(sender)) throw new Error("Unconfigured SIEM origin");
        return { ok: true };
      case "siem:api": {
        if (!await senderIsConfiguredSiem(sender)) throw new Error("Unconfigured SIEM origin");
        const origin = normalizeOrigin(new URL(sender.tab.url).origin);
        return { ok: true, response: await proxySiemApiRequest(origin, message) };
      }
      case "siem:ioc-description:set": {
        if (!await senderIsConfiguredSiem(sender)) throw new Error("Unconfigured SIEM origin");
        const settings = await loadSettings();
        if (!settings.features.addIocDescription) throw new Error("IOC description is disabled");
        const origin = normalizeOrigin(new URL(sender.tab.url).origin);
        return { ok: true, result: await setIocDescription(origin, message, settings) };
      }
      case "siem:table-list:apply": {
        if (!await senderIsConfiguredSiem(sender)) throw new Error("Unconfigured SIEM origin");
        const settings = await loadSettings();
        if (!settings.features.tableListTools) throw new Error("Table List tools are disabled");
        const origin = normalizeOrigin(new URL(sender.tab.url).origin);
        return { ok: true, result: await applyTableListMutation(origin, message) };
      }
      default:
        return undefined;
    }
  } catch (error) {
    const normalized = normalizeError(error, ERROR_CODES.UNKNOWN);
    return { ok: false, error: normalized.message, errorCode: normalized.code, kind: error.kind ?? "feature-unavailable" };
  }
});

refreshRegistrations().catch(console.error);
