import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Firefox popup sizing", () => {
  it("uses an intrinsic fixed width instead of viewport units", async () => {
    const css = await readFile(new URL("../src/static/popup.css", import.meta.url), "utf8");
    const bodyRule = css.match(/body\s*\{([^}]+)\}/)?.[1] ?? "";

    expect(bodyRule).toMatch(/\bwidth:\s*760px\s*;/);
    expect(bodyRule).not.toMatch(/\b(?:vw|dvw|svw|lvw)\b/);
  });
  it("zooms the complete process view instead of changing only its font", async () => {
    const script = await readFile(new URL("../src/popup/popup.js", import.meta.url), "utf8");
    expect(script).toContain("output.style.zoom = String(state.processScale)");
    expect(script).not.toContain("output.style.fontSize");
  });
});
