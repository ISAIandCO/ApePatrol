import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";
import { describe, it, expect, vi } from "vitest";
import { mountWorkspace } from "@isaiandco/ape-share-core/ui/workspace";
import { createInvestigationGraph } from "@isaiandco/ape-share-core/investigation/graph";

async function surface(overrides = {}) {
  const html = await readFile(new URL(import.meta.resolve("@isaiandco/ape-share-core/templates/workspace.html")), "utf8");
  const dom = new JSDOM(html, { url: "https://extension.test/workspace?id=a" });
  const window = dom.window;
  window.ResizeObserver = class { observe() {} disconnect() {} };
  window.requestAnimationFrame = () => 1; window.cancelAnimationFrame = () => {};
  window.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => () => {} });
  window.HTMLCanvasElement.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  window.confirm = () => true;
  const item = { type: "event", value: "1", label: "First", createdAt: 1000, snapshot: { time: "2026-09-09T12:00:00Z", host: "host", text: "needle" } };
  const workspaces = ["a", "b"].map(id => ({ id, title: id, items: [{ ...item }], tags: [], notes: "Notes", createdAt: 1000, updatedAt: 1000, status: "open" }));
  const chats = { a: { draft: "Question", messages: [] }, b: { draft: "Other question", messages: [] } };
  const request = vi.fn(async message => {
    if (message.type === "settings:get") return { settings: { ai: { endpoint: "https://ai.test", model: "model" } } };
    if (message.type === "workspace:list") return { workspaces };
    if (message.type === "workspace:chat:get") return { chat: chats[message.id] };
    if (message.type === "workspace:chat:save") { chats[message.id] = structuredClone(message.chat); return {}; }
    if (message.type === "workspace:update") { Object.assign(workspaces.find(w => w.id === message.id), message.patch); return { workspace: { id: message.id } }; }
    throw new Error(message.type);
  });
  const buildInvestigationGraph = createInvestigationGraph({ eventIdentity: item => item.value,
    investigationEventTime: item => Date.parse(item.snapshot.time), describeInvestigationEvent: () => ({ title: "event", description: "description" }),
    extractedEntities: event => [{ spec: { key: "host", type: "host", label: "Host", fields: ["host"] }, field: "host", value: event.host }],
  });
  const adapter = { request, eventTime: event => event.time, buildInvestigationGraph, describeInvestigationEvent: () => ({ title: "event", description: "description" }),
    canSearch: () => true, canOpenEvent: () => false, ...overrides };
  const view = mountWorkspace(window.document, adapter);
  await view.ready;
  return { dom, window, view, request, chats, workspaces, byId: id => window.document.getElementById(id), close() { view.destroy(); window.close(); } };
}

describe("shared workspace runtime", () => {
  it("renders, filters the entity graph, and saves status through the adapter", async () => {
    const app = await surface();
    expect(app.byId("workspace-items").children.length).toBe(1);
    app.byId("workspace-event-search").value = "needle";
    app.byId("workspace-event-search").dispatchEvent(new app.window.Event("input"));
    expect(app.byId("investigation-graph-summary").textContent).toContain("1 событий · 1 сущностей · 1 связей");
    app.byId("workspace-event-search").value = "absent";
    app.byId("workspace-event-search").dispatchEvent(new app.window.Event("input"));
    expect(app.byId("investigation-graph-summary").textContent).toContain("0 событий");
    app.byId("workspace-state").value = "closed"; app.byId("workspace-save").click();
    await vi.waitFor(() => expect(app.workspaces[0].status).toBe("closed"));
    app.close();
  });
  it("saves a late AI answer in its original investigation after switching", async () => {
    let finish;
    const app = await surface({ requestAiCompletion: () => new Promise(resolve => { finish = resolve; }) });
    app.view.state.aiPreviewHash = "reviewed";
    app.byId("workspace-ai-run").disabled = false;
    app.byId("workspace-ai-run").click();
    expect(finish).toBeTypeOf("function");
    await app.view.selectWorkspace("b");
    finish({ content: "Answer for a" });
    await vi.waitFor(() => expect(app.chats.a.messages.at(-1)?.content).toBe("Answer for a"));
    expect(app.view.state.selectedId).toBe("b");
    expect(app.view.state.aiChat.messages).toEqual([]);
    expect(app.byId("workspace-ai-message").value).toBe("Other question");
    app.close();
  });
});
