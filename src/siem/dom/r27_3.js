const FIELD_SELECTORS = ["[data-field-name]", "[data-field]", "mc-dt", "[title]"];
const VALUE_SELECTORS = [".pt-preserve-white-space", "[data-field-value]", ".event-field-value", "pdql-fast-filter"];
const EVENT_CARD_SELECTOR = "[data-testid='event-card'], pt-event-card, .event-card, .event-sidebar, [class*='event-card']";
const EVENT_TIME_SELECTOR = [
  ".layout-padding-no-left.mc-sidebar-header__title.flex",
  ".layout-padding_no-left.mc-sidebar-header__title.flex",
  "mc-sidebar-opened > header > .layout-row.flex > div > div",
].join(", ");
const FIELD_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_.]*$/;

function frameDocument(element) {
  if (!/^(?:IFRAME|FRAME)$/.test(element?.tagName ?? "")) return null;
  try {
    return element.contentDocument ?? null;
  } catch {
    return null;
  }
}

function allRoots(root = document) {
  const roots = [root];
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    const currentDocument = frameDocument(current);
    if (currentDocument && !roots.includes(currentDocument)) {
      roots.push(currentDocument);
      queue.push(currentDocument);
    }
    for (const element of current.querySelectorAll?.("*") ?? []) {
      if (element.shadowRoot && !roots.includes(element.shadowRoot)) {
        roots.push(element.shadowRoot);
        queue.push(element.shadowRoot);
      }
      const childDocument = frameDocument(element);
      if (childDocument && !roots.includes(childDocument)) {
        roots.push(childDocument);
        queue.push(childDocument);
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

function queryAllDeep(selector, root = document) {
  const matches = [];
  for (const candidate of allRoots(root)) {
    for (const match of candidate.querySelectorAll?.(selector) ?? []) {
      if (!matches.includes(match)) matches.push(match);
    }
  }
  return matches;
}

function labelName(label) {
  return (label?.dataset?.fieldName
    ?? label?.dataset?.field
    ?? label?.getAttribute?.("title")
    ?? label?.textContent
    ?? "").trim();
}

function findFieldLabel(name, root) {
  for (const selector of FIELD_SELECTORS) {
    for (const label of queryAllDeep(selector, root)) {
      if (labelName(label) === name) return label;
    }
  }
  return null;
}

function connected(root) {
  return Boolean(root?.isConnected || root?.host?.isConnected || root?.documentElement?.isConnected);
}

export class SiemDomAdapter {
  constructor() {
    this.cachedRoot = null;
    this.cachedCard = null;
    this.cachedCardRoots = null;
  }

  detect() {
    return Boolean(this.getRoot() && (this.getEventCard() || queryDeep("siem-core, ips-shell-remote-app, ips-root, pt-siem-main, mc-navbar-title")));
  }

  getRoot() {
    if (this.cachedRoot && (this.cachedRoot.isConnected || this.cachedRoot.host?.isConnected)) return this.cachedRoot;
    const legacyFrame = queryDeep("#legacyApplicationFrame");
    this.cachedRoot = queryDeep("siem-core")?.shadowRoot
      ?? queryDeep("ips-shell-remote-app")?.shadowRoot
      ?? queryDeep("main, [role='main']")
      ?? frameDocument(legacyFrame)
      ?? document.body;
    return this.cachedRoot;
  }

  getEventCard() {
    if (connected(this.cachedCard)) return this.cachedCard;
    const root = this.getRoot();
    this.cachedCard = queryDeep(EVENT_CARD_SELECTOR, root);
    if (!this.cachedCard) {
      const sidebars = queryAllDeep("mc-sidebar, mc-sidebar-opened", root);
      this.cachedCard = sidebars.reverse().find((candidate) => findFieldLabel("uuid", candidate))
        ?? sidebars.find((candidate) => queryDeep("mc-dt", candidate))
        ?? null;
    }
    if (!this.cachedCard && findFieldLabel("uuid", root)) this.cachedCard = root;
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
    return findFieldLabel(name, card);
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

  getEventTime() {
    const fieldTime = this.getEventField("time");
    if (fieldTime) return fieldTime;
    const header = queryDeep(EVENT_TIME_SELECTOR, this.getEventCard() ?? this.getRoot());
    return header?.textContent?.trim().replace(",", "") || null;
  }
  getEventUuid() { return this.getEventField("uuid"); }
  getFilterEditor() { return queryDeep("textarea[data-testid*='filter'], pdql-editor textarea, [class*='filter-editor'] textarea", this.getRoot()); }
  getRuleCard() { return queryDeep("[data-testid*='correlation-rule'], [class*='correlation-rule']", this.getEventCard() ?? this.getRoot()); }
  getAssetFields() { return queryDeep("[data-testid*='asset'], [class*='asset']", this.getEventCard() ?? this.getRoot()); }

  extractVisibleFields() {
    const card = this.getEventCard();
    if (!card) return {};
    const event = {};
    const seen = new Set();
    for (const selector of FIELD_SELECTORS) {
      for (const label of queryAllDeep(selector, card)) {
        if (seen.has(label)) continue;
        seen.add(label);
        const name = labelName(label);
        if (!FIELD_NAME_PATTERN.test(name) || event[name] !== undefined) continue;
        const value = this.readFieldContainer(label);
        if (value !== null && value !== "") event[name] = value;
      }
    }
    return event;
  }

  extractEvent() {
    const names = [
      "uuid", "time", "msgid", "event_src.host", "src.ip", "dst.ip", "src.port", "dst.port",
      "subject.account.name", "object.account.name", "object.process.id", "object.process.parent.id",
      "object.process.guid", "object.process.parent.guid", "subject.process.guid", "object.process.name",
      "object.process.parent.name", "object.process.cmdline", "object.hash", "object.name", "external_link",
      "correlation_name", "incident_id", "asset.id", "event_src.asset.id", "src.asset.id", "dst.asset.id",
      "event_src.asset", "src.asset", "dst.asset",
    ];
    const event = this.extractVisibleFields();
    for (const name of names) {
      if (event[name] !== undefined) continue;
      const value = name === "time" ? this.getEventTime() : this.getEventField(name);
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

export { allRoots, queryAllDeep, queryDeep, SiemDomAdapter as R27_3Adapter };
