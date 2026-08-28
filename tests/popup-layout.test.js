import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Firefox popup sizing", () => {
  it("uses an intrinsic fixed width instead of viewport units", async () => {
    const css = await readFile(new URL("../src/static/popup.css", import.meta.url), "utf8");
    const bodyRule = css.match(/body\s*\{([^}]+)\}/)?.[1] ?? "";

    expect(bodyRule).toMatch(/\bwidth:\s*760px\s*;/);
    expect(bodyRule).not.toMatch(/\b(?:vw|dvw|svw|lvw)\b/);
  });
});
