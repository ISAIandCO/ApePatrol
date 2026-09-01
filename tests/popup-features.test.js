import { describe, expect, it, vi } from "vitest";
import { loadOptionalPopupFeatures } from "../src/popup/feature-loader.js";

describe("popup feature isolation", () => {
  it("does not request a disabled related-events feature", async () => {
    const request = vi.fn();
    const result = await loadOptionalPopupFeatures({
      settings: { features: { relatedEvents: false } },
      context: { event: {} },
      request,
    });
    expect(result).toEqual({});
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps a rule result when related events fail", async () => {
    const request = vi.fn(async (message) => {
      if (message.type === "siem:related") throw new Error("provider failed");
      return { ok: true, knowledgeBaseUrl: "https://siem.example/kb" };
    });
    const result = await loadOptionalPopupFeatures({
      settings: { features: { relatedEvents: true } },
      context: { event: { correlation_name: "Rule A" } },
      request,
    });
    expect(result.related).toMatchObject({ ok: false });
    expect(result.rule).toEqual({ ok: true, value: { ok: true, knowledgeBaseUrl: "https://siem.example/kb" } });
  });

  it("resolves hidden incident fields for a correlation event", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, incident: { correlationType: "incident" } });
    const result = await loadOptionalPopupFeatures({
      settings: { features: { relatedEvents: false, incidentContext: true, ruleIntelligence: false } },
      context: { event: { uuid: "event-1", correlation_name: "Rule A" } },
      request,
    });
    expect(request).toHaveBeenCalledWith({ type: "siem:incident-context" });
    expect(result.incident).toEqual({ ok: true, value: { ok: true, incident: { correlationType: "incident" } } });
  });

  it("does not query incident context when incident_id is already visible", async () => {
    const request = vi.fn();
    await loadOptionalPopupFeatures({
      settings: { features: { relatedEvents: false, incidentContext: true, ruleIntelligence: false } },
      context: { event: { uuid: "event-1", incident_id: "INC-1" } },
      request,
    });
    expect(request).not.toHaveBeenCalled();
  });
});
