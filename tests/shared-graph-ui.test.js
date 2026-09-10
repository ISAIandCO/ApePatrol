import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { describe, it, expect, vi } from "vitest";
import { mountProcessGraph } from "@isaiandco/ape-share-core/ui/process-graph";
import { InvestigationCanvas } from "@isaiandco/ape-share-core/ui/investigation-canvas";

async function surface() {
  const html = await readFile(new URL("../src/static/process-graph.html", import.meta.url), "utf8");
  const dom = new JSDOM(html, { url: "https://extension.test/graph", pretendToBeVisual: true });
  const window = dom.window;
  const observers = [];
  window.ResizeObserver = class { constructor() { this.disconnect = vi.fn(); observers.push(this); } observe() {} };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.requestAnimationFrame = vi.fn(() => 1);
  window.cancelAnimationFrame = vi.fn();
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
  window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  window.HTMLCanvasElement.prototype.hasPointerCapture = () => false;
  return { dom, window, document: window.document, observers };
}

describe("shared graph runtime", () => {
  it("pins the tooltip with right click, opens with left click, and releases listeners", async () => {
    const app = await surface();
    const response = { graph: { nodes: [] }, sourceNodeId: "a", queryMetadata: {} };
    const open = vi.fn();
    const view = mountProcessGraph(app.document, {
      isAvailable: () => true, load: async () => response, open, cancel: vi.fn(),
      buildView: () => ({ nodes: [{ id: "a", time: 1, depth: 0, radius: 10, label: "process", selected: true, connectionCount: 0, details: [], filterValues: {} }], edges: [] }),
    });
    await vi.waitFor(() => expect(view.state.nodes.length).toBe(1));
    const node = view.state.nodes[0];
    const position = { clientX: node.x * view.state.scale + view.state.offsetX, clientY: node.y * view.state.scale + view.state.offsetY, bubbles: true };
    const canvas = app.document.getElementById("process-canvas");
    canvas.dispatchEvent(new app.window.MouseEvent("contextmenu", { ...position, button: 2 }));
    expect(app.document.getElementById("process-tooltip").classList.contains("pinned")).toBe(true);
    expect(open).not.toHaveBeenCalled();
    canvas.dispatchEvent(new app.window.MouseEvent("pointerdown", { ...position, button: 0 }));
    canvas.dispatchEvent(new app.window.MouseEvent("pointerup", { ...position, button: 0 }));
    expect(open).toHaveBeenCalledTimes(1);
    view.destroy();
    canvas.dispatchEvent(new app.window.MouseEvent("pointerdown", { ...position, button: 0 }));
    canvas.dispatchEvent(new app.window.MouseEvent("pointerup", { ...position, button: 0 }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(app.observers[0].disconnect).toHaveBeenCalled();
    app.window.close();
  });

  it("ignores a late response after cancellation", async () => {
    const app = await surface();
    let finish;
    const cancel = vi.fn();
    const view = mountProcessGraph(app.document, { isAvailable: () => true,
      load: () => new Promise(resolve => { finish = resolve; }), cancel,
      buildView: () => ({ nodes: [], edges: [] }),
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    app.document.getElementById("cancel-expand").click();
    finish({ graph: { nodes: [] } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(view.state.response).toBeNull();
    view.destroy(); app.window.close();
  });

  it("investigation canvas stores preferences through its adapter and destroys observers", async () => {
    const app = await surface();
    const saveForceSettings = vi.fn();
    const view = new InvestigationCanvas(app.document.getElementById("process-canvas"), app.document.getElementById("process-tooltip"), { saveForceSettings });
    view.updateForceSetting("linkDistance", 150);
    view.persistForceSettings();
    expect(saveForceSettings).toHaveBeenCalledWith(expect.objectContaining({ linkDistance: 150 }));
    view.destroy(); expect(app.observers[0].disconnect).toHaveBeenCalled();
    app.window.close();
  });
});
