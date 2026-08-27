const FIELD_SELECTORS = ["[data-field-name]", "[data-field]", "[title]"];
const VALUE_SELECTORS = [".pt-preserve-white-space", "[data-field-value]", ".event-field-value", "pdql-fast-filter"];

function allRoots(root = document) {
  const roots = [root];
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    for (const element of current.querySelectorAll?.("*") ?? []) {
      if (element.shadowRoot && !roots.includes(element.shadowRoot)) {
        roots.push(element.shadowRoot);
        queue.push(element.shadowRoot);
      }
    }
  }
  return roots;
}

function queryDeep(selector, root = document) {
  for (const candidate of allRoots(root)) {
    const match = candidate.querySelector?.(selector);
    if (match) return match;
  }
  return null;
}

export class R27_3Adapter {
  constructor() {
    this.cachedRoot = null;
    this.cachedCard = null;
    this.cachedCardRoots = null;
  }

  detect() {
    return Boolean(this.getRoot() && (this.getEventCard() || queryDeep("siem-core, ips-shell-remote-app")));
  }

  getRoot() {
    if (this.cachedRoot && (this.cachedRoot.isConnected || this.cachedRoot.host?.isConnected)) return this.cachedRoot;
    this.cachedRoot = queryDeep("siem-core")?.shadowRoot
      ?? queryDeep("ips-shell-remote-app")?.shadowRoot
      ?? queryDeep("main, [role='main'], #legacyApplicationFrame")
      ?? document.body;
    return this.cachedRoot;
  }

  getEventCard() {
    if (this.cachedCard?.isConnected) return this.cachedCard;
    this.cachedCard = queryDeep("[data-testid='event-card'], pt-event-card, .event-card, .event-sidebar, [class*='event-card']", this.getRoot());
    this.cachedCardRoots = this.cachedCard ? allRoots(this.cachedCard) : null;
    return this.cachedCard;
  }

  refreshFieldRoots() {
    const card = this.getEventCard();
    this.cachedCardRoots = card ? allRoots(card) : null;
  }

  getEventField(name) {
    const field = this.getEventFieldElement(name);
    return field ? this.readFieldContainer(field) : null;
  }

  getEventFieldElement(name) {
    const card = this.getEventCard();
    if (!card) return null;
    const escaped = CSS.escape(name);
    const roots = this.cachedCardRoots ?? allRoots(card);
    const direct = roots.map((root) => root.querySelector?.(`[data-field-name='${escaped}'], [data-field='${escaped}']`)).find(Boolean);
    if (direct) return direct;
    for (const selector of FIELD_SELECTORS) {
      for (const root of roots) {
        for (const label of root.querySelectorAll?.(selector) ?? []) {
          const labelName = label.dataset?.fieldName ?? label.dataset?.field ?? label.getAttribute("title") ?? label.textContent;
          if (labelName?.trim() === name) return label;
        }
      }
    }
    return null;
  }

  readFieldContainer(label) {
    const explicit = label.querySelector?.("[data-field-value]");
    if (explicit) return explicit.textContent?.trim() ?? null;
    const sibling = label.nextElementSibling;
    if (sibling) {
      for (const selector of VALUE_SELECTORS) {
        const value = sibling.matches?.(selector) ? sibling : sibling.querySelector?.(selector);
        if (value?.textContent?.trim()) return value.textContent.trim();
      }
      if (sibling.textContent?.trim()) return sibling.textContent.trim();
    }
    return label.dataset?.fieldValue ?? null;
  }

  getEventTime() { return this.getEventField("time"); }
  getEventUuid() { return this.getEventField("uuid"); }
  getFilterEditor() { return queryDeep("textarea[data-testid*='filter'], pdql-editor textarea, [class*='filter-editor'] textarea", this.getRoot()); }
  getRuleCard() { return queryDeep("[data-testid*='correlation-rule'], [class*='correlation-rule']", this.getEventCard() ?? this.getRoot()); }
  getAssetFields() { return queryDeep("[data-testid*='asset'], [class*='asset']", this.getEventCard() ?? this.getRoot()); }

  extractEvent() {
    const names = [
      "uuid", "time", "msgid", "event_src.host", "src.ip", "dst.ip", "src.port", "dst.port",
      "subject.account.name", "object.account.name", "object.process.id", "object.process.parent.id",
      "object.process.guid", "object.process.parent.guid", "subject.process.guid", "object.process.name",
      "object.process.parent.name", "object.process.cmdline", "object.hash", "object.name", "external_link",
      "correlation_name", "incident_id", "asset.id", "event_src.asset.id", "src.asset.id", "dst.asset.id",
      "event_src.asset", "src.asset", "dst.asset",
    ];
    const event = {};
    for (const name of names) {
      const value = this.getEventField(name);
      if (value !== null && value !== "") event[name] = value;
    }
    return event;
  }

  isNativeFeaturePresent(feature, fieldElement = this.getEventCard()) {
    if (!fieldElement) return false;
    const selectors = {
      copyPdql: "[data-testid*='copy-pdql'], [aria-label*='PDQL' i], [title*='PDQL' i]",
      correlationDescription: "[data-testid*='rule-description'], [class*='correlation-description']",
      autocomplete: "[role='listbox'][data-testid*='autocomplete'], [class*='pdql-autocomplete']",
      eventActions: "[data-testid*='event-field-actions']",
    };
    return Boolean(selectors[feature] && queryDeep(selectors[feature], fieldElement));
  }
}

export { allRoots, queryDeep };
