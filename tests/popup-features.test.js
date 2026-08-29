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
});
