import { describe, expect, it } from "vitest";
import { domSettingsFingerprint, settingsImpact } from "../src/content/settings-runtime.js";
import { normalizeSettings } from "../src/shared/settings.js";

function settings(overrides = {}) {
  return normalizeSettings({
    instances: ["https://siem.example"],
    ...overrides,
  });
}

describe("live content settings", () => {
  it("rebuilds DOM features only when their inputs change", () => {
    const before = settings();
    const processOnly = settings({ process: { maxNodes: 5000, maxDepth: 64 } });
    expect(domSettingsFingerprint(before)).toBe(domSettingsFingerprint(processOnly));
    expect(settingsImpact(before, processOnly, "https://siem.example").rebuildDom).toBe(false);
    const providers = settings({ externalProviders: [{ id: "custom", name: "Custom", type: "ip", urlTemplate: "https://lookup.example/${ip}" }] });
    expect(settingsImpact(before, providers, "https://siem.example").rebuildDom).toBe(true);
  });

  it("deactivates all extension UI when the origin is removed", () => {
    const impact = settingsImpact(settings(), normalizeSettings({ instances: [] }), "https://siem.example");
    expect(impact).toMatchObject({ wasActive: true, active: false, rebuildDom: false });
  });

  it("activates an already-loaded content runtime when an origin is restored", () => {
    const impact = settingsImpact(normalizeSettings({ instances: [] }), settings(), "https://siem.example");
    expect(impact).toMatchObject({ wasActive: false, active: true, rebuildDom: true });
  });
});
