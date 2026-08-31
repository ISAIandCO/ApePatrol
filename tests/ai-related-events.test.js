import { describe, expect, it } from "vitest";
import { resolveAiRelatedRequest } from "../src/siem/features/related-events.js";

describe("AI related-event request", () => {
  const event = { time: "2026-08-31T10:00:00Z", "event_src.host": "pc-1", "src.ip": "192.0.2.1" };

  it("derives a bounded allowlisted query only from the current event", () => {
    const request = resolveAiRelatedRequest(event, { relation: "host", range: "24h", limit: 1000 });
    expect(request.relation).toBe("host");
    expect(request.range).toBe("24h");
    expect(request.limit).toBe(25);
    expect(request.action.where).toContain("pc-1");
  });

  it("rejects unknown and unavailable relations", () => {
    expect(() => resolveAiRelatedRequest(event, { relation: "arbitrary_pdql" })).toThrow("Unknown");
    expect(() => resolveAiRelatedRequest({}, { relation: "account" })).toThrow("no account relation");
  });
});
