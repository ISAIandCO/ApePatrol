import { describe, expect, it, vi } from "vitest";
import { buildIncidentContext, resolveIncidentContext } from "../src/siem/features/incident-context.js";

describe("incident context", () => {
  it("recognizes incident-producing correlation events", () => {
    expect(buildIncidentContext({
      uuid: "event-1",
      correlation_name: "Rule A",
      correlation_type: "Incident",
    })).toMatchObject({
      eventUuid: "event-1",
      correlationName: "Rule A",
      correlationType: "incident",
      incidentId: null,
    });
  });

  it("loads an incident_id that is hidden in the event card", async () => {
    const client = { searchEvents: vi.fn().mockResolvedValue({ events: [{ uuid: "event-1", incident_id: "INC-42", correlation_type: "incident" }] }) };
    const context = await resolveIncidentContext(client, {
      uuid: "event-1",
      time: "2026-09-01T08:32:35Z",
      correlation_name: "Rule A",
    }, { scope: { searchType: "all" } });

    expect(context).toMatchObject({ incidentId: "INC-42", correlationType: "incident", source: "events-api" });
    expect(client.searchEvents).toHaveBeenCalledWith(expect.objectContaining({
      where: "uuid = 'event-1'",
      select: ["uuid", "time", "correlation_name", "correlation_type", "incident_id"],
      limit: 1,
      scope: { searchType: "all" },
    }));
  });

  it("does not query the API when incident_id is visible", async () => {
    const client = { searchEvents: vi.fn() };
    await expect(resolveIncidentContext(client, { uuid: "event-1", incident_id: "INC-1" })).resolves.toMatchObject({ incidentId: "INC-1", source: "event-card" });
    expect(client.searchEvents).not.toHaveBeenCalled();
  });
});
