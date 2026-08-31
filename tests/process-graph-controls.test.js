import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("process graph controls", () => {
  it("defaults expansion to 15 minutes and can raise the node limit directly", async () => {
    const html = await readFile(new URL("../src/static/process-graph.html", import.meta.url), "utf8");
    const script = await readFile(new URL("../src/process-graph/process-graph.js", import.meta.url), "utf8");
    expect(html).toContain('<option value="900" selected>15 минут</option>');
    expect(html).toContain("Снять лимит до 10 000 узлов");
    expect(script).toContain("{ nodeLimit: 10_000, resumeLimit: true }");
  });
});
