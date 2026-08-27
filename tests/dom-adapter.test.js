// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { R27_3Adapter } from "../src/siem/dom/r27_3.js";
import { IocDescriptionFeature } from "../src/siem/features/ioc-description.js";

beforeAll(() => { globalThis.CSS ??= {}; CSS.escape ??= (value) => String(value).replace(/["'\\]/g, "\\$&"); });
const fixtureDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name) => readFile(path.join(fixtureDirectory, `${name}.html`), "utf8");

describe("MP SIEM 27.3 DOM adapter fixtures", () => {
  it("extracts the event card", async () => {
    document.body.innerHTML = await fixture("event-card");
    const adapter = new R27_3Adapter();
    expect(adapter.getEventUuid()).toBe("event-123");
    expect(adapter.getEventField("src.ip")).toBe("192.0.2.4");
  });
  it("detects native correlation description", async () => {
    document.body.innerHTML = await fixture("correlation-event");
    expect(new R27_3Adapter().isNativeFeaturePresent("correlationDescription")).toBe(true);
  });
  it("detects filter, process and asset fixtures", async () => {
    document.body.innerHTML = await fixture("filter-editor");
    expect(new R27_3Adapter().getFilterEditor()).toBeTruthy();
    document.body.innerHTML = await fixture("process-event");
    expect(new R27_3Adapter().getEventField("object.process.guid")).toBe("{GUID}");
    document.body.innerHTML = await fixture("asset-field");
    expect(new R27_3Adapter().getAssetFields()).toBeTruthy();
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
    expect(document.querySelector(".siem-monkey-ioc-description")).toBeTruthy();
    feature.unmount();
  });
});
