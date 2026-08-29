import { describe, expect, it } from "vitest";
import { buildRuleIntelligence } from "../src/siem/features/rule-intelligence.js";

describe("Rule Intelligence", () => {
  it("uses only explicit ATT&CK mappings", () => {
    const intelligence = buildRuleIntelligence({ id: "r1", name: "Rule", severity: "high", metadata: { mitre: { techniques: ["T1059"] } } }, { correlation_name: "Rule" }, "https://siem.example/kb");
    expect(intelligence).toMatchObject({ id: "r1", severity: "high", mitreTechniques: ["T1059"], mitreSource: "explicit-siem-metadata" });
  });

  it("does not guess ATT&CK from a process name", () => {
    const intelligence = buildRuleIntelligence({ id: "r2", name: "PowerShell rule" }, { correlation_name: "PowerShell rule", "object.process.name": "powershell.exe" });
    expect(intelligence.mitreTechniques).toEqual([]);
    expect(intelligence.mitreSource).toBeNull();
  });
});
