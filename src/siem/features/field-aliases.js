export class FieldAliasesFeature {
  constructor(fieldAliases) {
    this.fieldAliases = fieldAliases;
    this.elements = new Set();
  }

  onDomChanged({ event, adapter }) {
    const aliases = { ...(this.fieldAliases.default ?? {}), ...(this.fieldAliases[event.correlation_name] ?? {}) };
    for (const [field, alias] of Object.entries(aliases)) {
      const label = adapter.getEventFieldElement(field);
      if (!label || label.querySelector(`:scope > [data-apepatrol-alias='${CSS.escape(field)}']`)) continue;
      const element = document.createElement("span");
      element.dataset.apepatrolAlias = field;
      element.dataset.apepatrolUi = "alias";
      element.className = "apepatrol-field-alias";
      element.textContent = ` — ${alias}`;
      label.append(element);
      this.elements.add(element);
    }
  }

  unmount() {
    for (const element of this.elements) element.remove();
    this.elements.clear();
  }
}
