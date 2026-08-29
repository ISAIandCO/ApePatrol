import { queryDeep } from "../dom/r27_3.js";

export class IocDescriptionFeature {
  constructor(client, settings, logger) {
    this.client = client;
    this.settings = settings;
    this.logger = logger;
    this.table = null;
    this.user = null;
    this.input = null;
    this.actionButton = null;
    this.status = null;
    this.form = null;
    this.pending = false;
  }

  async mount() {
    if (!this.settings.features.addIocDescription) return;
    try {
      const [tables, user] = await Promise.all([this.client.getTableLists(), this.client.getCurrentUser()]);
      const list = Array.isArray(tables) ? tables : tables?.items ?? tables?.lists ?? [];
      this.table = list.find((item) => [item.name, item.displayName, item.title].includes(this.settings.iocListName)) ?? null;
      this.user = user?.login ?? user?.name ?? user?.username ?? "unknown";
      if (!this.table) this.logger.debug("IOC description disabled: list was not found", { list: this.settings.iocListName });
      else this.onDomChanged();
    } catch (error) {
      this.logger.debug("IOC description capability unavailable", { kind: error.kind });
    }
  }

  onDomChanged() {
    if (!this.table || this.input?.isConnected) return;
    const form = queryDeep("form[action*='/whitelists/'], [data-testid*='table-list-add'], [class*='whitelist'][class*='dialog']");
    if (!form || form.querySelector(".apepatrol-ioc-description")) return;
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 500;
    input.className = "apepatrol-ioc-description";
    input.placeholder = "IOC description (optional)";
    input.autocomplete = "off";
    input.dataset.apepatrolUi = "true";
    const action = document.createElement("button");
    action.type = "button";
    action.className = "apepatrol-ioc-description-submit";
    action.dataset.apepatrolUi = "true";
    action.textContent = "Add IOC with description";
    const status = document.createElement("span");
    status.className = "apepatrol-ioc-description-status";
    status.dataset.apepatrolUi = "true";
    status.setAttribute("role", "status");
    action.addEventListener("click", (event) => {
      if (!event.isTrusted) return;
      this.submitCurrentRow().catch((error) => this.setStatus(error.message, true));
    });
    form.append(input, action, status);
    this.form = form;
    this.input = input;
    this.actionButton = action;
    this.status = status;
  }

  readNativeRow() {
    if (!this.form) return [];
    const controls = [...this.form.querySelectorAll("input, select, textarea")]
      .filter((control) => control !== this.input && !control.disabled && !["button", "submit", "reset", "file"].includes(control.type))
      .filter((control) => !["checkbox", "radio"].includes(control.type) || control.checked);
    return controls.map((control) => control.value);
  }

  setStatus(message, error = false) {
    if (!this.status) return;
    this.status.textContent = message;
    this.status.classList.toggle("error", error);
  }

  async submitCurrentRow({ confirmOperation = globalThis.confirm } = {}) {
    if (this.pending) throw new Error("IOC operation is already in progress");
    const token = this.table?.token ?? this.table?.id;
    const description = this.input?.value.trim() ?? "";
    const row = this.readNativeRow();
    if (!token || !description) throw new Error("Enter an IOC description first");
    if (!row.length) throw new Error("ApePatrol could not read the native Table List row");
    if (!confirmOperation?.(`Add this IOC row to ${this.settings.iocListName} with the entered description?`)) return false;
    this.pending = true;
    this.actionButton.disabled = true;
    this.setStatus("Adding IOC…");
    try {
      const response = await browser.runtime.sendMessage({
        type: "siem:ioc-description:set",
        token: String(token),
        row,
        description,
        username: String(this.user),
      });
      if (!response?.ok) throw new Error(response?.error ?? "IOC insertion failed");
      this.input.value = "";
      this.setStatus("IOC added with description.");
      return true;
    } finally {
      this.pending = false;
      if (this.actionButton) this.actionButton.disabled = false;
    }
  }

  unmount() {
    this.input?.remove();
    this.actionButton?.remove();
    this.status?.remove();
    this.form = null;
    this.input = null;
    this.actionButton = null;
    this.status = null;
    this.pending = false;
  }
}
