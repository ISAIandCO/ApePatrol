import { queryDeep } from "../dom/r27_3.js";

export class EdrUiFeature {
  constructor(enabled) { this.enabled = enabled; this.hidden = new Set(); }
  onDomChanged() {
    if (!this.enabled) return;
    const root = queryDeep("[data-testid*='edr-integration'], [class*='edr-integration'], [aria-label*='EDR' i]");
    if (root && !this.hidden.has(root)) {
      root.dataset.siemMonkeyPreviousDisplay = root.style.display;
      root.style.display = "none";
      this.hidden.add(root);
    }
  }
  unmount() {
    for (const element of this.hidden) {
      element.style.display = element.dataset.siemMonkeyPreviousDisplay ?? "";
      delete element.dataset.siemMonkeyPreviousDisplay;
    }
    this.hidden.clear();
  }
}
