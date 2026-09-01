// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SiemDomAdapter } from "../src/siem/dom/r27_3.js";
import { EventFieldActions } from "../src/siem/features/event-actions.js";
import { IocDescriptionFeature } from "../src/siem/features/ioc-description.js";

beforeAll(() => { globalThis.CSS ??= {}; CSS.escape ??= (value) => String(value).replace(/["'\\]/g, "\\$&"); });
const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => readFile(path.join(fixtureDirectory, `${name}.html`), "utf8");

describe("MP SIEM DOM adapter fixtures", () => {
  it("extracts the event card", async () => {
    document.body.innerHTML = await fixture("event-card");
    const adapter = new SiemDomAdapter();
    expect(adapter.getEventUuid()).toBe("event-123");
    expect(adapter.getEventField("src.ip")).toBe("192.0.2.4");
  });
  it("extracts the real R27.3 mc-sidebar markup through nested shadow roots", () => {
    document.body.innerHTML = "<ips-root><main><ips-shell-remote-app></ips-shell-remote-app></main></ips-root>";
    const remoteApp = document.querySelector("ips-shell-remote-app");
    const shellRoot = remoteApp.attachShadow({ mode: "open" });
    const siemCore = document.createElement("siem-core");
    shellRoot.append(siemCore);
    const siemRoot = siemCore.attachShadow({ mode: "open" });
    siemRoot.innerHTML = `
      <mc-sidebar>
        <mc-sidebar-opened>
          <header><div class="layout-padding-no-left mc-sidebar-header__title flex">28.08.2026, 08:38:55</div></header>
          <div><mc-dt> uuid </mc-dt><mc-dd><pdql-fast-filter><span class="pt-preserve-white-space">event-r273</span></pdql-fast-filter></mc-dd></div>
          <div><mc-dt> event_src.host </mc-dt><mc-dd><pdql-fast-filter>win-host-01</pdql-fast-filter></mc-dd></div>
          <div><mc-dt> object.process.cmdline </mc-dt><mc-dd><pdql-fast-filter>cmd.exe /c whoami</pdql-fast-filter></mc-dd></div>
          <div><mc-dt> chain_id </mc-dt><mc-dd><pdql-fast-filter>chain-42</pdql-fast-filter></mc-dd></div>
          <div><mc-dt> correlation_type </mc-dt><mc-dd><pdql-fast-filter>incident</pdql-fast-filter></mc-dd></div>
        </mc-sidebar-opened>
      </mc-sidebar>`;

    const adapter = new SiemDomAdapter();
    expect(adapter.detect()).toBe(true);
    expect(adapter.extractEvent()).toMatchObject({
      uuid: "event-r273",
      time: "28.08.2026 08:38:55",
      "event_src.host": "win-host-01",
      "object.process.cmdline": "cmd.exe /c whoami",
      chain_id: "chain-42",
      correlation_type: "incident",
    });
  });
  it("reaches a same-origin legacy application iframe without all-frames injection", () => {
    document.body.innerHTML = "<iframe id='legacyApplicationFrame'></iframe>";
    const frameDocument = document.querySelector("iframe").contentDocument;
    frameDocument.body.innerHTML = `
      <mc-sidebar><div><mc-dt> uuid </mc-dt><mc-dd>iframe-event</mc-dd></div></mc-sidebar>`;

    expect(new SiemDomAdapter().getEventUuid()).toBe("iframe-event");
  });
  it("keeps the legacy title/value sidebar fallback", () => {
    document.body.innerHTML = `
      <mc-sidebar class="mc-sidebar_wide mc-sidebar_right">
        <mc-sidebar-opened>
          <header><div class="layout-row flex"><div><div>28.08.2026 08:38:55</div></div></div></header>
          <div><div title="uuid">uuid</div><div><div><div>legacy-event</div></div></div></div>
          <div><div title="src.ip">src.ip</div><div><div><div>192.0.2.45</div></div></div></div>
        </mc-sidebar-opened>
      </mc-sidebar>`;

    const adapter = new SiemDomAdapter();
    expect(adapter.detect()).toBe(true);
    expect(adapter.getEventUuid()).toBe("legacy-event");
    expect(adapter.getEventField("src.ip")).toBe("192.0.2.45");
  });
  it("attaches a separate action to each concrete field label", () => {
    document.body.innerHTML = `
      <article class="event-card">
        <mc-dt> uuid </mc-dt><mc-dd>event-actions</mc-dd>
        <mc-dt> src.ip </mc-dt><mc-dd>192.0.2.10</mc-dd>
        <mc-dt> dst.ip </mc-dt><mc-dd>198.51.100.20</mc-dd>
      </article>`;
    const adapter = new SiemDomAdapter();
    const feature = new EventFieldActions({ features: { eventActions: true }, externalProviders: [] });
    feature.onDomChanged({ event: adapter.extractEvent(), adapter });

    const labels = [...document.querySelectorAll("mc-dt")];
    expect(labels.map((label) => label.querySelectorAll(":scope > .apepatrol-field-action").length)).toEqual([1, 1, 1]);
    expect(document.querySelectorAll("article > .apepatrol-field-action")).toHaveLength(0);
    expect(adapter.getEventField("src.ip")).toBe("192.0.2.10");
    feature.unmount();
  });
  it("runs IOC enrichment from the icon attached to the concrete field", async () => {
    document.body.innerHTML = `
      <article class="event-card">
        <mc-dt> uuid </mc-dt><mc-dd>ioc-action</mc-dd>
        <mc-dt> src.ip </mc-dt><mc-dd>8.8.8.8</mc-dd>
      </article>`;
    globalThis.browser = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ ok: true, result: { provider: "VirusTotal", verdict: "clean-or-unknown", summary: "0 detections", details: {} } }),
        openOptionsPage: vi.fn(),
      },
    };
    const adapter = new SiemDomAdapter();
    const feature = new EventFieldActions({ features: { eventActions: true }, externalProviders: [] });
    feature.onDomChanged({ event: adapter.extractEvent(), adapter });

    const actionButton = document.querySelector("mc-dt:nth-of-type(2) .apepatrol-field-action");
    let actionBox = { left: 100, right: 120, top: 100, bottom: 120 };
    vi.spyOn(actionButton, "getBoundingClientRect").mockImplementation(() => actionBox);
    actionButton.click();
    const menu = document.querySelector(".apepatrol-action-menu");
    expect(menu.style.top).toBe("124px");
    actionBox = { left: 100, right: 120, top: 200, bottom: 220 };
    document.body.dispatchEvent(new Event("scroll"));
    expect(menu.style.top).toBe("224px");
    const apiButton = [...document.querySelectorAll(".apepatrol-action-menu button")].find((button) => button.textContent === "VirusTotal API");
    expect(apiButton).toBeTruthy();
    apiButton.click();
    await vi.waitFor(() => expect(document.querySelector(".apepatrol-enrichment-result")?.textContent).toContain("VirusTotal"));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({ type: "enrichment:ioc", provider: "virustotal", ioc: { type: "ip", value: "8.8.8.8" } });
    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    expect(document.querySelector(".apepatrol-action-menu")).toBeNull();
    feature.unmount();
  });
  it("adds direct event actions to the open SIEM card", async () => {
    document.body.innerHTML = `
      <mc-sidebar><mc-sidebar-opened>
        <header><div class="layout-padding-no-left mc-sidebar-header__title flex">2026-09-01T10:00:00Z</div></header>
        <mc-dt> uuid </mc-dt><mc-dd>event-toolbar</mc-dd>
        <mc-dt> event_src.host </mc-dt><mc-dd>host-1</mc-dd>
      </mc-sidebar-opened></mc-sidebar>`;
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
    globalThis.browser = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, workspace: { title: "IR-1" }, downloadId: 7 }) } };
    const adapter = new SiemDomAdapter();
    const feature = new EventFieldActions({ features: { eventActions: true, investigationWorkspace: true }, externalProviders: [] });
    feature.onDomChanged({ event: adapter.extractEvent(), adapter });

    const card = adapter.getEventCard();
    expect(card.firstElementChild.tagName).toBe("HEADER");
    expect(card.querySelector(".mc-sidebar-header__title > .apepatrol-event-actions")?.textContent).toBe("🐵 Действия");
    expect(adapter.getEventTime()).toBe("2026-09-01T10:00:00Z");
    const buttons = [...document.querySelectorAll(".apepatrol-event-actions-menu button")];
    expect(buttons.map((button) => button.textContent)).toEqual(["📌 В расследование", "Копировать JSON", "Копировать ссылку", "Скачать JSON"]);
    buttons[0].click(); buttons[1].click(); buttons[3].click();
    await vi.waitFor(() => expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "downloads:text" })));
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "workspace:item:add", item: expect.objectContaining({ type: "event", value: "event-toolbar" }) }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('"uuid": "event-toolbar"'));
    feature.unmount();
  });
  it("detects native correlation description", async () => {
    document.body.innerHTML = await fixture("correlation-event");
    expect(new SiemDomAdapter().isNativeFeaturePresent("correlationDescription")).toBe(true);
  });
  it("detects filter, process and asset fixtures", async () => {
    document.body.innerHTML = await fixture("filter-editor");
    expect(new SiemDomAdapter().getFilterEditor()).toBeTruthy();
    document.body.innerHTML = await fixture("process-event");
    expect(new SiemDomAdapter().getEventField("object.process.guid")).toBe("{GUID}");
    document.body.innerHTML = await fixture("asset-field");
    expect(new SiemDomAdapter().getAssetFields()).toBeTruthy();
  });
  it("prefers the active filter editor when MaxPatrol keeps an older editor mounted", () => {
    document.body.innerHTML = `
      <textarea id="pdqlFilterText"></textarea>
      <events-filter-popover><textarea data-testid="filter-editor"></textarea></events-filter-popover>`;
    const activeEditor = document.querySelector("events-filter-popover textarea");
    activeEditor.focus();
    expect(new SiemDomAdapter().getFilterEditor()).toBe(activeEditor);
  });
  it("mounts IOC description only after resolving the configured list", async () => {
    document.body.innerHTML = await fixture("table-list");
    globalThis.browser = { runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true, result: {} }) } };
    const client = {
      getTableLists: async () => [{ name: "IOCs_Value", token: "list-token" }],
      getCurrentUser: async () => ({ login: "analyst" }),
    };
    const feature = new IocDescriptionFeature(client, { features: { addIocDescription: true }, iocListName: "IOCs_Value" }, { debug() {} });
    await feature.mount();
    feature.onDomChanged();
    expect(document.querySelector(".apepatrol-ioc-description")).toBeTruthy();
    document.querySelector(".apepatrol-ioc-description").value = "Public resolver";
    await expect(feature.submitCurrentRow({ confirmOperation: () => true })).resolves.toBe(true);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: "siem:ioc-description:set",
      token: "list-token",
      row: ["8.8.8.8", "ip", ""],
      description: "Public resolver",
      username: "analyst",
    });
    feature.unmount();
  });
  it("prevents a double IOC-description submit and keeps the UI pending", async () => {
    document.body.innerHTML = await fixture("table-list");
    let finish;
    globalThis.browser = { runtime: { sendMessage: vi.fn(() => new Promise((resolve) => { finish = resolve; })) } };
    const client = {
      getTableLists: async () => [{ name: "IOCs_Value", token: "list-token" }],
      getCurrentUser: async () => ({ login: "analyst" }),
    };
    const feature = new IocDescriptionFeature(client, { features: { addIocDescription: true }, iocListName: "IOCs_Value" }, { debug() {} });
    await feature.mount();
    feature.input.value = "Description";
    const firstSubmit = feature.submitCurrentRow({ confirmOperation: () => true });
    expect(feature.actionButton.disabled).toBe(true);
    await expect(feature.submitCurrentRow({ confirmOperation: () => true })).rejects.toThrow("already in progress");
    finish({ ok: true, result: {} });
    await expect(firstSubmit).resolves.toBe(true);
    expect(browser.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(feature.actionButton.disabled).toBe(false);
    feature.unmount();
  });
});
