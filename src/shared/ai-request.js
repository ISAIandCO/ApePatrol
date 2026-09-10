import { requestChatCompletion } from "@isaiandco/ape-share-core/ai/transport";
import { normalizeAiResponse, prepareAiRequest } from "./ai-payload.js";
import { loadSecrets, loadSettings } from "./storage.js";
import { parseSafeExternalUrl } from "./url.js";

async function hasAiDataPermission() {
  try {
    const permissions = await browser.permissions.getAll();
    return ["websiteContent", "authenticationInfo"].every((type) => permissions.data_collection?.includes(type));
  } catch {
    return false;
  }
}

// Run in the visible chat page so a slow local model is not tied to an MV3 background message channel.
export async function requestAiCompletion(message) {
  if (message.confirmed !== true) throw new Error("Operator confirmation is required");
  const [settings, secrets] = await Promise.all([loadSettings(), loadSecrets()]);
  if (!settings.features.aiAssistant) throw new Error("AI assistant is disabled");
  const endpoint = parseSafeExternalUrl(settings.ai.endpoint);
  if (!endpoint || !settings.ai.model || !secrets.llmApiKey) throw new Error("AI endpoint, model, or key is not configured");
  if (message.previewEndpoint !== endpoint.href) throw new Error("AI endpoint changed; review the final payload again");
  if (!await browser.permissions.contains({ origins: [`${endpoint.origin}/*`] })) throw new Error("AI endpoint host permission is missing");
  if (!await hasAiDataPermission()) throw new Error("Firefox data-collection permission is missing");
  const prepared = await prepareAiRequest(message.event, settings.ai, {
    selectedFields: message.selectedFields,
    conversation: message.conversation,
    contextType: message.contextType,
    allowSiemTools: message.allowSiemTools,
  });
  if (!message.previewHash || message.previewHash !== prepared.hash) throw new Error("AI preview is stale; review the final payload again");
  const responseMessage = await requestChatCompletion(endpoint, prepared.serialized, { apiKey: secrets.llmApiKey });
  return { ...normalizeAiResponse(responseMessage, message), sentFields: prepared.sentFields, bytes: prepared.byteLength, endpoint: endpoint.origin };
}
