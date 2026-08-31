import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Firefox external data consent flow", () => {
  it("requests data collection and provider origins in separate user actions", async () => {
    const source = await readFile(new URL("../src/options/options.js", import.meta.url), "utf8");
    expect(source).toContain('browser.permissions.request({ data_collection: ["websiteContent", "authenticationInfo"] })');
    expect(source).toContain("browser.permissions.request({ origins: [origin] })");
    expect(source).not.toMatch(/permissions\.request\(\{[^}]*data_collection[^}]*origins/s);
  });

  it("does not make saving a key depend on a permission prompt", async () => {
    const source = await readFile(new URL("../src/options/options.js", import.meta.url), "utf8");
    const secretSaveBody = source.match(/async function saveSecrets[\s\S]*?\n\}\n\nasync function exportProfile/)?.[0] ?? "";
    expect(secretSaveBody).toContain('type: "secrets:save"');
    expect(secretSaveBody).not.toContain("permissions.request");
  });
});
