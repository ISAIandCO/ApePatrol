// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
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
  it("mounts IOC description only after resolving the configured list", async () => {
    document.body.innerHTML = await fixture("table-list");
    const client = {
      getTableLists: async () => [{ name: "IOCs_Value", token: "list-token" }],
      getCurrentUser: async () => ({ login: "analyst" }),
    };
    const feature = new IocDescriptionFeature(client, { features: { addIocDescription: true }, iocListName: "IOCs_Value" }, { debug() {} });
    await feature.mount();
    feature.onDomChanged();
    expect(document.querySelector(".apepatrol-ioc-description")).toBeTruthy();
    feature.unmount();
  });
});
