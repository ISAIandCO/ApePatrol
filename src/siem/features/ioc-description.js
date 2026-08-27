import { queryDeep } from "../dom/r27_3.js";

export class IocDescriptionFeature {
  constructor(client, settings, logger) {
    this.client = client;
    this.settings = settings;
    this.logger = logger;
    this.table = null;
    this.user = null;
    this.input = null;
    this.boundButton = null;
  }

  async mount() {
    if (!this.settings.features.addIocDescription) return;
    try {
      const [tables, user] = await Promise.all([this.client.getTableLists(), this.client.getCurrentUser()]);
      const list = Array.isArray(tables) ? tables : tables?.items ?? tables?.lists ?? [];
      this.table = list.find((item) => [item.name, item.displayName, item.title].includes(this.settings.iocListName)) ?? null;
      this.user = user?.login ?? user?.name ?? user?.username ?? "unknown";
      if (!this.table) this.logger.debug("IOC description disabled: list was not found", { list: this.settings.iocListName });
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
    form.append(input);
    const submit = form.querySelector("button[type='submit'], [data-testid*='submit']");
    if (submit) {
      const send = () => {
        const token = this.table.token ?? this.table.id;
        if (!token || !input.value.trim()) return;
        window.postMessage({
          source: "apepatrol",
          type: "ioc-description",
            token: String(token),
            description: input.value.trim(),
            username: String(this.user),
            expiresAt: Date.now() + 30000,
        }, location.origin);
        input.value = "";
      };
      submit.addEventListener("click", send);
      this.boundButton = { submit, send };
    }
    this.input = input;
  }

  unmount() {
    if (this.boundButton) this.boundButton.submit.removeEventListener("click", this.boundButton.send);
    this.boundButton = null;
    this.input?.remove();
    this.input = null;
  }
}
