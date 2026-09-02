import { loadSecrets, loadSettings, loadSettingsState, saveSecrets, saveSettings } from "../shared/storage.js";
import { normalizeOrigin, originPattern, parseSafeExternalUrl } from "../shared/url.js";
import { isExtensionPageSender } from "../shared/runtime-sender.js";
import { proxySiemApiRequest } from "./siem-proxy.js";
import { IOC_API_PROVIDERS, lookupIoc } from "./ioc-enrichment.js";
import { setIocDescription } from "./ioc-description.js";
import { applyTableListMutation } from "./table-list.js";
import { deleteGraphSnapshot, getGraphSnapshot, saveGraphSnapshot, updateGraphSnapshot } from "./graph-snapshots.js";
import { normalizeAiToolCalls, prepareAiRequest } from "../shared/ai-payload.js";
import { ERROR_CODES, normalizeError } from "../shared/errors.js";
import { cancelIocBatch, runIocBatch } from "./ioc-batch.js";
import { deleteTabSession, getTabSession, saveTabSession } from "./tab-sessions.js";
import { downloadText } from "../shared/download.js";
import { indexedDbSessionStorage } from "./session-state.js";
import {
  createInvestigation,
  deleteWorkspace,
  getWorkspaceAiChat,
  getWorkspace,
  importWorkspaceAiChat,
  listWorkspaces,
  pinWorkspaceItem,
  removeWorkspaceItem,
  saveWorkspaceAiChat,
  updateWorkspace,
} from "./workspaces.js";

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
  const requestOptions = {
    selectedFields: message.selectedFields,
    conversation: message.conversation,
    contextType: message.contextType,
    allowSiemTools: message.allowSiemTools,
  };
  const prepared = await prepareAiRequest(message.event, settings.ai, requestOptions);
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
    const responseMessage = body?.choices?.[0]?.message;
    const content = typeof responseMessage?.content === "string" ? responseMessage.content.slice(0, 100000) : "";
    const toolCalls = normalizeAiToolCalls(responseMessage, message.contextType);
    if (!content && !toolCalls.length) throw new Error("Unexpected LLM response schema");
    return { content, toolCalls, sentFields: prepared.sentFields, bytes: prepared.byteLength, endpoint: endpoint.origin };
  } finally {
    clearTimeout(timer);
  }
}

browser.runtime.onInstalled.addListener(() => refreshRegistrations().catch(console.error));
browser.runtime.onStartup.addListener(() => {
  refreshRegistrations().catch(console.error);
  indexedDbSessionStorage.clear().catch(console.error);
});
browser.permissions.onAdded.addListener(() => refreshRegistrations().catch(console.error));
browser.permissions.onRemoved.addListener(() => refreshRegistrations().catch(console.error));
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "managed" && Object.keys(changes).length) refreshRegistrations().catch(console.error);
});
browser.tabs.onRemoved.addListener((tabId) => deleteTabSession(tabId).catch(console.error));

browser.runtime.onMessage.addListener(async (message, sender) => {
  try {
    switch (message?.type) {
      case "settings:get":
        return { ok: true, ...(await loadSettingsState()) };
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
      case "graph:snapshot:update":
        assertExtensionPage(sender);
        return { ok: true, snapshot: await updateGraphSnapshot(message.id, message.snapshot) };
      case "graph:snapshot:delete":
        assertExtensionPage(sender);
        return { ok: true, deleted: await deleteGraphSnapshot(message.id) };
      case "tab-session:get":
        assertExtensionPage(sender);
        return { ok: true, session: await getTabSession(message.tabId) };
      case "tab-session:save":
        assertExtensionPage(sender);
        return { ok: true, session: await saveTabSession(message.tabId, message.session) };
      case "downloads:text": {
        const extensionSender = isExtensionPageSender(sender, browser.runtime.getURL("/"));
        if (!extensionSender && !await senderIsConfiguredSiem(sender)) throw new Error("Download is restricted to ApePatrol and configured SIEM pages");
        return { ok: true, downloadId: await downloadText(message.content, message.options) };
      }
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
      case "enrichment:batch:start": {
        assertExtensionPage(sender);
        if (!await hasDataPermission(["websiteContent", "authenticationInfo"])) throw new Error("Разрешение Firefox на передачу IOC и API-ключей не выдано");
        return { ok: true, batch: await runIocBatch(message) };
      }
      case "enrichment:batch:cancel":
        assertExtensionPage(sender);
        return { ok: true, cancelled: cancelIocBatch(message.requestId) };
      case "enrichment:llm":
        assertExtensionPage(sender);
        return { ok: true, result: await llmRequest(message) };
      case "ai:preview": {
        assertExtensionPage(sender);
        const settings = await loadSettings();
        if (!settings.features.aiAssistant) throw new Error("AI assistant is disabled");
        const endpoint = parseSafeExternalUrl(settings.ai.endpoint);
        if (!endpoint || !settings.ai.model) throw new Error("AI endpoint or model is not configured");
        return { ok: true, endpoint: endpoint.origin, preview: await prepareAiRequest(message.event, settings.ai, {
          selectedFields: message.selectedFields,
          conversation: message.conversation,
          contextType: message.contextType,
          allowSiemTools: message.allowSiemTools,
        }) };
      }
      case "workspace:list":
        assertExtensionPage(sender);
        return { ok: true, workspaces: await listWorkspaces() };
      case "workspace:get":
        assertExtensionPage(sender);
        return { ok: true, workspace: await getWorkspace(message.id) };
      case "workspace:create":
        assertExtensionPage(sender);
        return { ok: true, workspace: await createInvestigation(message.workspace) };
      case "workspace:update":
        assertExtensionPage(sender);
        return { ok: true, workspace: await updateWorkspace(message.id, message.patch) };
      case "workspace:delete":
        assertExtensionPage(sender);
        return { ok: true, deleted: await deleteWorkspace(message.id) };
      case "workspace:item:remove":
        assertExtensionPage(sender);
        return { ok: true, workspace: await removeWorkspaceItem(message.id, message.index) };
      case "workspace:chat:get":
        assertExtensionPage(sender);
        return { ok: true, chat: await getWorkspaceAiChat(message.id) };
      case "workspace:chat:save":
        assertExtensionPage(sender);
        return { ok: true, chat: await saveWorkspaceAiChat(message.id, message.chat) };
      case "workspace:chat:import":
        assertExtensionPage(sender);
        return { ok: true, chat: await importWorkspaceAiChat(message.id, message.chat) };
      case "workspace:item:add": {
        const extensionSender = isExtensionPageSender(sender, browser.runtime.getURL("/"));
        const siemSender = !extensionSender && await senderIsConfiguredSiem(sender);
        if (!extensionSender && !siemSender) throw new Error("Workspace pin is restricted to ApePatrol and configured SIEM pages");
        const siemOrigin = siemSender ? normalizeOrigin(new URL(sender.tab.url).origin) : normalizeOrigin(message.siemOrigin);
        return { ok: true, workspace: await pinWorkspaceItem({ ...message, siemOrigin }) };
      }
      case "content:ready":
        if (!await senderIsConfiguredSiem(sender)) throw new Error("Unconfigured SIEM origin");
        return { ok: true };
      case "siem:api": {
        if (!await senderIsConfiguredSiem(sender)) throw new Error("Unconfigured SIEM origin");
        const origin = normalizeOrigin(new URL(sender.tab.url).origin);
        return { ok: true, response: await proxySiemApiRequest(origin, message) };
      }
      case "workspace:siem-api": {
        assertExtensionPage(sender);
        const workspace = await getWorkspace(message.workspaceId);
        const origin = normalizeOrigin(message.origin);
        const settings = await loadSettings();
        if (!workspace || !origin || workspace.siemOrigin !== origin || !settings.instances.includes(origin)) {
          throw new Error("Workspace is not linked to a configured SIEM origin");
        }
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
