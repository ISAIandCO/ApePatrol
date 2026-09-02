import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("investigation graph controls", () => {
  it("uses the shared dynamic force engine with a collapsed settings panel", async () => {
    const html = await readFile(new URL("../src/static/workspace.html", import.meta.url), "utf8");
    const script = await readFile(new URL("../src/workspace/investigation-canvas.js", import.meta.url), "utf8");
    expect(html).toContain('<details class="workspace-force-panel">');
    expect(html).not.toContain('<details class="workspace-force-panel" open>');
    for (const id of ["workspace-force-attraction", "workspace-force-repulsion", "workspace-force-link-strength", "workspace-force-link-distance", "workspace-force-reset"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(script).toContain('from "../process-graph/force-layout.js"');
    expect(script).toContain("startSimulation({ fitWhenDone: true })");
  });
});
