import { describe, expect, it } from "vitest";
import { resolveKnowledgeBaseUrl } from "../src/siem/features/knowledge-base.js";

describe("Knowledge Base application discovery", () => {
  it("uses a registered HTTPS application instead of a hardcoded port", () => {
    const url = resolveKnowledgeBaseUrl({ groups: [{ applications: [{ displayName: "PT Knowledge Base", baseUrl: "https://kb.internal/app" }] }] }, { objectId: "rule id" });
    expect(url).toBe("https://kb.internal/#/siem/rule%20id");
  });
  it("rejects unsafe and absent application URLs", () => {
    expect(resolveKnowledgeBaseUrl([{ name: "Knowledge Base", url: "javascript:alert(1)" }], { objectId: "r" })).toBeNull();
    expect(resolveKnowledgeBaseUrl([], { objectId: "r" })).toBeNull();
  });
});
