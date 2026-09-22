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

it('operation categories load on demand, preserve graph view, group and collapse, then load another page', async () => {
  const app = await surface();
  const from = Date.parse('2026-01-01T00:00:00Z');
  const response = { graph: { nodes: [{ id: 'a', event: { uuid: 'source' } }] }, sourceNodeId: 'a',
    operationProfiles: [{ enabled: true, category: 'files', platform: 'windows' }, { enabled: true, category: 'network', platform: 'windows' }],
    queryMetadata: { timeFrom: new Date(from).toISOString(), timeTo: new Date(from + 60000).toISOString() } };
  const search = vi.fn(async ({ cursor, category }) => ({ scanned: 25, more: !cursor, cursor: (cursor || 0) + 25,
    facts: Array.from({ length: 25 }, (_, i) => ({ id: `${category}-${(cursor || 0) + i}`, host: 'host.example', pid: '42', time: from + 1000,
      label: '/test/file', objectKey: 'same-file', raw: { uuid: String(i) }, operation: '11' })) }));
  const open = vi.fn(async () => {});
  const view = mountProcessGraph(app.document, { search: '?layout=step', isAvailable: () => true, load: async () => response, open,
    processIdentity: () => ({ host: 'host.example', pid: '42', time: from, platform: 'windows' }), searchOperations: search,
    buildView: () => ({ nodes: [{ id: 'a', time: from, depth: 0, radius: 10, label: 'process', selected: true, connectionCount: 0, details: [], filterValues: {}, event: { uuid: 'source' } }], edges: [] }) });
  await vi.waitFor(() => expect(view.state.nodes.length).toBe(1));
  expect(search).not.toHaveBeenCalled();
  const source = view.state.nodes[0]; source.anchorX = source.x; source.anchorY = source.y;
  const before = { x: source.x, y: source.y, anchorX: source.anchorX, anchorY: source.anchorY, scale: view.state.scale, offsetX: view.state.offsetX, offsetY: view.state.offsetY };
  const canvas = app.document.getElementById('process-canvas');
  const card = node => canvas.dispatchEvent(new app.window.MouseEvent('contextmenu', { clientX: node.x * view.state.scale + view.state.offsetX, clientY: node.y * view.state.scale + view.state.offsetY, button: 2, bubbles: true }));
  const button = text => [...app.document.querySelectorAll('#process-tooltip button')].find(item => item.textContent === text && !item.disabled);
  card(source); expect(search).not.toHaveBeenCalled(); button('Загрузить до 25').click();
  await vi.waitFor(() => expect(view.state.nodes.length).toBe(3));
  expect(search).toHaveBeenCalledTimes(1); expect(search.mock.calls[0][0].limit).toBe(25);
  expect(view.state.nodes[0]).toBe(source); expect(source.event.uuid).toBe('source');
  expect({ x: source.x, y: source.y, anchorX: source.anchorX, anchorY: source.anchorY, scale: view.state.scale, offsetX: view.state.offsetX, offsetY: view.state.offsetY }).toEqual(before);
  expect(view.state.nodes.find(node => node.operationKind === 'object').facts).toHaveLength(25);
  button('Свернуть').click(); expect(view.state.nodes.length).toBe(2);
  button('Раскрыть').click(); expect(view.state.nodes.length).toBe(3);
  button('Показать ещё 25 / повторить').click();
  await vi.waitFor(() => expect(view.state.nodes.find(node => node.operationKind === 'object').facts.length).toBe(50));
  expect(search.mock.calls[1][0].cursor).toBe(25);
  button('Загрузить до 25').click();
  await vi.waitFor(() => expect(search).toHaveBeenCalledTimes(3));
  expect(search.mock.calls[2][0].category).toBe('network'); expect(search.mock.calls[2][0].cursor).toBeNull();
  view.destroy(); app.window.close();
});
