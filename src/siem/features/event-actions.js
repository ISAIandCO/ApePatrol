import { buildEqualityPredicate } from "../../shared/pdql/builder.js";
import { extractPreferredHash } from "../../shared/hash.js";
import { classifyIp } from "../../shared/ip.js";
import { fillUrlTemplate, parseSafeExternalUrl } from "../../shared/url.js";
import { buildEventSearchUrl } from "./related-events.js";

const ACTION_FIELDS = [
  "src.ip", "dst.ip", "event_src.host", "subject.account.name", "object.account.name",
  "object.process.guid", "subject.process.guid", "object.process.name", "object.hash", "external_link", "uuid",
];

export class EventFieldActions {
  constructor(settings) {
    this.settings = settings;
    this.elements = new Set();
  }

  mount() {}

  onDomChanged({ event, adapter }) {
    if (!this.settings.features.eventActions) return;
    for (const field of ACTION_FIELDS) {
      const value = event[field];
      const label = value && adapter.getEventFieldElement(field);
      if (!label || label.parentElement?.querySelector(":scope > .apepatrol-field-action")) continue;
      if (adapter.isNativeFeaturePresent("eventActions", label.parentElement) || adapter.isNativeFeaturePresent("copyPdql", label.parentElement)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "apepatrol-field-action";
      button.textContent = "🐵";
      button.title = `ApePatrol actions: ${field}`;
      button.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        this.openMenu(button, field, value, event);
      });
      label.parentElement?.append(button);
      this.elements.add(button);
    }
  }

  openMenu(anchor, field, rawValue, event) {
    document.querySelector(".apepatrol-action-menu")?.remove();
    const value = field.endsWith("hash") ? (extractPreferredHash(rawValue) ?? rawValue) : rawValue;
    const menu = document.createElement("div");
    menu.className = "apepatrol-action-menu";
    const add = (label, handler) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", async () => { await handler(); menu.remove(); });
      menu.append(button);
    };
    add("Copy value", () => navigator.clipboard.writeText(String(value)));
    const predicate = buildEqualityPredicate(field, value);
    add("Copy PDQL predicate", () => navigator.clipboard.writeText(predicate));
    for (const [label, preset] of [["Search same value", "15m"], ["Search ±1h", "1h"], ["Search ±24h", "24h"]]) {
      add(label, () => browser.runtime.sendMessage({ type: "tabs:open", url: buildEventSearchUrl(location.origin, predicate, event.time, preset) }));
    }
    if (field === "external_link") {
      const url = parseSafeExternalUrl(value);
      if (url) add("Open safe link", () => browser.runtime.sendMessage({ type: "tabs:open", url: url.href }));
    }
    for (const provider of this.settings.externalProviders.filter((item) => item.enabled && fieldMatchesProvider(field, item.type))) {
      if (provider.type === "ip") {
        const category = classifyIp(String(value));
        if (category === "invalid" || (category !== "public" && !provider.allowPrivate)) continue;
      }
      const url = fillUrlTemplate(provider.urlTemplate, { [provider.type]: value });
      if (url) add(provider.name, () => browser.runtime.sendMessage({ type: "tabs:open", url: url.href }));
    }
    const box = anchor.getBoundingClientRect();
    menu.style.left = `${Math.min(box.left, innerWidth - 280)}px`;
    menu.style.top = `${Math.min(box.bottom + 4, innerHeight - 260)}px`;
    document.body.append(menu);
    const close = (event) => { if (!menu.contains(event.target) && event.target !== anchor) menu.remove(); };
    setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
  }

  unmount() {
    for (const element of this.elements) element.remove();
    this.elements.clear();
    document.querySelector(".apepatrol-action-menu")?.remove();
  }
}

function fieldMatchesProvider(field, type) {
  if (type === "ip") return field.endsWith(".ip");
  if (type === "hash") return field.endsWith("hash");
  return type === "url" && field === "external_link";
}
