import { normalizeAiAttachment } from "@isaiandco/ape-share-core/ai/chat";
export * from "@isaiandco/ape-share-core/ai/chat";

export function eventAiAttachment(event = {}) {
  const value = String(event.uuid ?? event.id ?? ([event.time, event["event_src.host"], event.correlation_name].filter(Boolean).join(":") || "current-event"));
  const label = [event.correlation_name, event["event_src.host"], event.time].filter(Boolean).join(" · ") || value;
  return normalizeAiAttachment({ type: "event", value, label, sourceEventUuid: event.uuid ?? null, snapshot: event });
}
