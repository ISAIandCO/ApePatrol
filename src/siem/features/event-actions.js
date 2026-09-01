import { buildEqualityPredicate } from "../../shared/pdql/builder.js";
import { iocFromField } from "../../shared/ioc.js";
import { classifyIp } from "../../shared/ip.js";
import { fillUrlTemplate, parseSafeExternalUrl, sanitizeFilenamePart } from "../../shared/url.js";
import { buildEventSearchUrl } from "./related-events.js";

const ACTION_FIELDS = [
  "src.ip", "dst.ip", "event_src.host", "subject.account.name", "object.account.name",
  "object.process.guid", "subject.process.guid", "object.process.name", "object.hash", "subject.hash",
  "file.hash", "src.domain", "dst.domain", "object.domain", "dns.query", "object.url", "url",
  "external_link", "uuid",
];

const API_PROVIDERS = Object.freeze([
  { id: "virustotal", name: "VirusTotal API", types: ["ip", "hash", "domain", "url"] },
  { id: "abuseipdb", name: "AbuseIPDB API", types: ["ip"] },
  { id: "opentip", name: "Kaspersky OpenTIP API", types: ["ip", "hash", "domain", "url"] },
  { id: "threatfox", name: "ThreatFox API", types: ["ip", "hash", "domain", "url"] },
]);

function workspaceItem(field, value, ioc, event) {
  const type = ioc ? "ioc"
    : field === "event_src.host" ? "host"
      : field.includes("account") ? "account"
        : field.includes("process") ? "process"
          : field === "uuid" ? "event" : null;
  if (!type) return null;
  return {
    type,
    value: String(ioc ? `${ioc.type}:${ioc.value}` : value),
    label: `${field}: ${String(ioc?.value ?? value).slice(0, 180)}`,
    sourceEventUuid: event.uuid ?? null,
    snapshot: ioc ? { iocType: ioc.type, value: ioc.value, sourceField: field } : { field, value },
  };
}

function eventWorkspaceItem(event) {
  const value = event.uuid ?? [event.time, event["event_src.host"], event.correlation_name].filter(Boolean).join(":");
  if (!value) return null;
  return {
    type: "event",
    value: String(value),
    label: String(event.correlation_name ?? event.uuid ?? value).slice(0, 300),
    sourceEventUuid: event.uuid ?? null,
    snapshot: event,
  };
}

function eventFilename(event) {
  const suffix = [event.time, event.uuid, event["event_src.host"]].map((value) => sanitizeFilenamePart(value, "")).filter(Boolean).join("-");
  return `siem-event-${suffix || "event"}.json`;
}

export class EventFieldActions {
  constructor(settings) {
    this.settings = settings;
    this.elements = new Set();
    this.eventToolbar = null;
    this.eventFingerprint = null;
  }

  mount() {}

  onDomChanged({ event, adapter }) {
    if (!this.settings.features.eventActions) return;
    this.mountEventToolbar(event, adapter);
    const actionFields = new Set([...ACTION_FIELDS, ...Object.keys(event).filter((field) => iocFromField(field, event[field]))]);
    for (const field of actionFields) {
      const value = event[field];
      const label = value && adapter.getEventFieldElement(field);
      if (!label || label.querySelector(":scope > .apepatrol-field-action")) continue;
      if (adapter.isNativeFeaturePresent("eventActions", label.parentElement) || adapter.isNativeFeaturePresent("copyPdql", label.parentElement)) continue;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "apepatrol-field-action";
      button.dataset.apepatrolUi = "action";
      button.textContent = "🐵";
      button.title = `ApePatrol actions: ${field}`;
      Object.assign(button.style, {
        marginInlineStart: "4px",
        padding: "1px 4px",
        border: "0",
        background: "transparent",
        cursor: "pointer",
        verticalAlign: "middle",
      });
      button.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        this.openMenu(button, field, value, event);
      });
      label.append(button);
      this.elements.add(button);
    }
  }

  mountEventToolbar(event, adapter) {
    const card = adapter.getEventCard();
    const eventJson = JSON.stringify(event, null, 2);
    const fingerprint = eventJson;
    if (!card || !Object.keys(event).length) {
      this.eventToolbar?.remove();
      this.eventToolbar = null;
      this.eventFingerprint = null;
      return;
    }
    if (this.eventToolbar?.parentNode === card && this.eventFingerprint === fingerprint) return;
    this.eventToolbar?.remove();

    const toolbar = document.createElement("div");
    toolbar.className = "apepatrol-event-actions";
    toolbar.dataset.apepatrolUi = "event-actions";
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "Действия ApePatrol с событием");
    const status = document.createElement("span");
    status.className = "apepatrol-event-action-status";
    status.setAttribute("aria-live", "polite");
    const add = (label, title, handler, enabled = true) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.title = title;
      button.disabled = !enabled;
      button.addEventListener("click", async (clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        status.classList.remove("error");
        try {
          const message = await handler();
          status.textContent = message ?? "Готово";
        } catch (error) {
          status.textContent = `Ошибка: ${error.message}`;
          status.classList.add("error");
        }
      });
      toolbar.append(button);
    };

    const item = this.settings.features.investigationWorkspace && eventWorkspaceItem(event);
    add("📌 В расследование", "Добавить событие в последнее расследование", async () => {
      const response = await browser.runtime.sendMessage({ type: "workspace:item:add", sourceIncidentId: event.incident_id ?? null, item });
      if (!response?.ok) throw new Error(response?.error ?? "Не удалось добавить событие");
      return `Добавлено в «${response.workspace.title}»`;
    }, Boolean(item));
    add("Копировать JSON", "Скопировать JSON события", async () => {
      await navigator.clipboard.writeText(eventJson);
      return "JSON скопирован";
    });
    add("Копировать ссылку", "Скопировать ссылку на событие", async () => {
      const url = buildEventSearchUrl(location.origin, buildEqualityPredicate("uuid", event.uuid), event.time, "5m");
      await navigator.clipboard.writeText(url);
      return "Ссылка скопирована";
    }, Boolean(event.uuid));
    add("Скачать JSON", "Скачать JSON события", async () => {
      const response = await browser.runtime.sendMessage({
        type: "downloads:text",
        content: eventJson,
        options: { filename: eventFilename(event), mime: "application/json" },
      });
      if (!response?.ok) throw new Error(response?.error ?? "Не удалось скачать JSON");
      return "Загрузка начата";
    });
    toolbar.append(status);
    card.prepend(toolbar);
    this.eventToolbar = toolbar;
    this.eventFingerprint = fingerprint;
    this.elements.add(toolbar);
  }

  openMenu(anchor, field, rawValue, event) {
    document.querySelector(".apepatrol-action-menu")?.remove();
    const ioc = iocFromField(field, rawValue);
    const value = ioc?.value ?? rawValue;
    const menu = document.createElement("div");
    menu.className = "apepatrol-action-menu";
    menu.setAttribute("role", "menu");
    const title = document.createElement("strong");
    title.className = "apepatrol-action-title";
    title.textContent = `${field}: ${String(value).slice(0, 120)}`;
    menu.append(title);
    const add = (label, handler, { keepOpen = false } = {}) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.addEventListener("click", async () => {
        try {
          await handler(button);
          if (!keepOpen) menu.remove();
        } catch (error) {
          renderLookupResult(menu, { error: error.message });
        }
      });
      menu.append(button);
    };
    add("Copy value", () => navigator.clipboard.writeText(String(value)));
    const predicate = buildEqualityPredicate(field, value);
    add("Copy PDQL predicate", () => navigator.clipboard.writeText(predicate));
    for (const [label, preset] of [["Open matching events in SIEM (±15m)", "15m"], ["Open matching events in SIEM (±1h)", "1h"], ["Open matching events in SIEM (±24h)", "24h"]]) {
      add(label, () => browser.runtime.sendMessage({ type: "tabs:open", url: buildEventSearchUrl(location.origin, predicate, event.time, preset) }));
    }
    const pinItem = this.settings.features.investigationWorkspace && workspaceItem(field, value, ioc, event);
    if (pinItem) add("📌 Прикрепить к расследованию", async () => {
      const response = await browser.runtime.sendMessage({
        type: "workspace:item:add",
        sourceIncidentId: event.incident_id ?? null,
        item: pinItem,
      });
      if (!response?.ok) throw new Error(response?.error ?? "Не удалось прикрепить объект");
      renderLookupResult(menu, { provider: "Workspace", verdict: "saved", summary: `Добавлено в «${response.workspace.title}»` });
    }, { keepOpen: true });
    if (field === "external_link") {
      const url = parseSafeExternalUrl(value);
      if (url) add("Open safe link", () => browser.runtime.sendMessage({ type: "tabs:open", url: url.href }));
    }
    if (ioc) {
      const apiHeading = document.createElement("span");
      apiHeading.className = "apepatrol-action-heading";
      apiHeading.textContent = "Проверить через API";
      menu.append(apiHeading);
      for (const provider of API_PROVIDERS.filter((item) => item.types.includes(ioc.type))) {
        add(provider.name, async (button) => {
          button.disabled = true;
          button.textContent = `${provider.name}: запрос…`;
          const response = await browser.runtime.sendMessage({ type: "enrichment:ioc", provider: provider.id, ioc });
          button.disabled = false;
          button.textContent = provider.name;
          if (!response?.ok) throw new Error(response?.error ?? "Провайдер не вернул результат");
          renderLookupResult(menu, response.result);
        }, { keepOpen: true });
      }
      const linkHeading = document.createElement("span");
      linkHeading.className = "apepatrol-action-heading";
      linkHeading.textContent = "Открыть отчёт на сайте";
      menu.append(linkHeading);
    }
    for (const provider of this.settings.externalProviders.filter((item) => item.enabled && ioc?.type === item.type)) {
      if (provider.type === "ip") {
        const category = classifyIp(String(value));
        if (category === "invalid" || (category !== "public" && !provider.allowPrivate)) continue;
      }
      const url = fillUrlTemplate(provider.urlTemplate, { [provider.type]: value });
      if (url) add(provider.name, () => browser.runtime.sendMessage({ type: "tabs:open", url: url.href }));
    }
    if (ioc) add("Настройки IOC-провайдеров…", () => browser.runtime.openOptionsPage());
    const box = anchor.getBoundingClientRect();
    document.body.append(menu);
    const width = Math.min(menu.offsetWidth || 360, innerWidth - 12);
    const height = Math.min(menu.offsetHeight || 420, innerHeight - 12);
    menu.style.left = `${Math.max(6, Math.min(box.left, innerWidth - width - 6))}px`;
    menu.style.top = `${Math.max(6, Math.min(box.bottom + 4, innerHeight - height - 6))}px`;
    const close = (event) => { if (!menu.contains(event.target) && event.target !== anchor) menu.remove(); };
    setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
  }

  unmount() {
    for (const element of this.elements) element.remove();
    this.elements.clear();
    this.eventToolbar = null;
    this.eventFingerprint = null;
    document.querySelector(".apepatrol-action-menu")?.remove();
  }
}

function renderLookupResult(menu, result) {
  let output = menu.querySelector(".apepatrol-enrichment-result");
  if (!output) {
    output = document.createElement("pre");
    output.className = "apepatrol-enrichment-result";
    output.setAttribute("aria-live", "polite");
    menu.append(output);
  }
  output.textContent = result.error
    ? `Ошибка: ${result.error}`
    : `${result.provider}: ${result.verdict}\n${result.summary}\n${JSON.stringify(result.details ?? {}, null, 2)}`;
}
