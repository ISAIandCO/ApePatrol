import { buildEqualityPredicate } from "../../shared/pdql/builder.js";
import { aroundTime } from "../../shared/time.js";

const INCIDENT_FIELDS = ["uuid", "time", "correlation_name", "correlation_type", "incident_id"];

function clean(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

export function buildIncidentContext(event = {}, source = "event-card") {
  return {
    incidentId: clean(event.incident_id),
    correlationName: clean(event.correlation_name),
    correlationType: clean(event.correlation_type)?.toLowerCase() ?? null,
    eventUuid: clean(event.uuid),
    source,
  };
}

export async function resolveIncidentContext(client, event, { scope = {} } = {}) {
  const visible = buildIncidentContext(event);
  if (visible.incidentId || !visible.eventUuid) return visible;
  const response = await client.searchEvents({
    where: buildEqualityPredicate("uuid", visible.eventUuid),
    select: INCIDENT_FIELDS,
    ...aroundTime(event.time, 300),
    limit: 1,
    scope,
  });
  const records = Array.isArray(response) ? response : Array.isArray(response?.events) ? response.events : [];
  return buildIncidentContext({ ...event, ...records[0] }, records.length ? "events-api" : "event-card");
}
