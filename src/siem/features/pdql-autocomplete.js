const PDQL_KEYWORDS = Object.freeze([
  "=", "!=", ">", "<", ">=", "<=", "in", "match", "startswith", "endswith",
  "contains", "and", "or", "not", "in_subnet",
]);

let listId = 0;

export function pdqlCompletionRange(value, caret) {
  const end = Math.max(0, Math.min(String(value).length, Number(caret) || 0));
  const match = /(?:[A-Za-z_][A-Za-z0-9_.]*|!=|>=|<=|!|=|>|<)$/.exec(String(value).slice(0, end));
  return match ? { start: end - match[0].length, end, token: match[0] } : null;
}

export function filterPdqlCompletions(items, token, limit = 40) {
  const needle = String(token).toLowerCase();
  if (!needle) return [];
  return [...new Set(items)].filter((item) => String(item).toLowerCase().startsWith(needle)).slice(0, limit);
}

export class PdqlAutocompleteFeature {
  constructor(client) {
    this.client = client;
    this.items = [...PDQL_KEYWORDS];
    this.loadPromise = null;
    this.bindings = new Map();
  }

  loadItems() {
    if (!this.loadPromise) {
      this.loadPromise = this.client.getEventMetadata().then((metadata) => {
        const fields = Array.isArray(metadata?.fields)
          ? metadata.fields.filter((field) => field?.filterable === true && typeof field.name === "string").map((field) => field.name)
          : [];
        this.items = [...fields, ...PDQL_KEYWORDS];
      }).catch(() => {
        this.loadPromise = null;
      });
    }
    return this.loadPromise;
  }

  onDomChanged({ adapter }) {
    for (const [editor, binding] of this.bindings) {
      if (!editor.isConnected) {
        binding.destroy();
        this.bindings.delete(editor);
      }
    }
    const editor = adapter.getFilterEditor();
    if (editor && !this.bindings.has(editor)) this.bind(editor);
  }

  bind(editor) {
    this.loadItems().then(() => this.render(editor));
    const list = editor.ownerDocument.createElement("div");
    list.id = `apepatrol-pdql-completions-${++listId}`;
    list.dataset.apepatrolUi = "pdql-autocomplete";
    list.setAttribute("role", "listbox");
    Object.assign(list.style, {
      position: "fixed", zIndex: "2147483647", display: "none", maxHeight: "260px", width: "min(420px, calc(100vw - 24px))",
      overflowY: "auto", padding: "4px", border: "1px solid #9aa0a6", borderRadius: "4px", background: "Canvas",
      color: "CanvasText", boxShadow: "0 6px 20px rgba(0,0,0,.24)", font: "13px system-ui, sans-serif",
    });
    editor.ownerDocument.body.append(list);
    editor.setAttribute("aria-autocomplete", "list");
    editor.setAttribute("aria-controls", list.id);
    editor.setAttribute("aria-expanded", "false");

    const input = () => {
      this.render(editor);
      this.loadItems().then(() => this.render(editor));
    };
    const keydown = (event) => this.onKeydown(event, editor);
    const blur = () => setTimeout(() => this.hide(editor), 0);
    editor.addEventListener("input", input);
    editor.addEventListener("keydown", keydown);
    editor.addEventListener("blur", blur);
    this.bindings.set(editor, {
      list,
      active: -1,
      destroy: () => {
        editor.removeEventListener("input", input);
        editor.removeEventListener("keydown", keydown);
        editor.removeEventListener("blur", blur);
        editor.removeAttribute("aria-autocomplete");
        editor.removeAttribute("aria-controls");
        editor.removeAttribute("aria-expanded");
        list.remove();
      },
    });
  }

  render(editor) {
    const binding = this.bindings.get(editor);
    if (!binding || !editor.matches(":focus")) return;
    const range = pdqlCompletionRange(editor.value, editor.selectionStart);
    const completions = range ? filterPdqlCompletions(this.items, range.token) : [];
    binding.list.replaceChildren();
    binding.active = -1;
    if (!completions.length) {
      this.hide(editor);
      return;
    }
    for (const completion of completions) {
      const option = editor.ownerDocument.createElement("button");
      option.type = "button";
      option.setAttribute("role", "option");
      option.textContent = completion;
      Object.assign(option.style, {
        display: "block", width: "100%", padding: "5px 8px", border: "0", borderRadius: "3px",
        background: "transparent", color: "inherit", textAlign: "left", cursor: "pointer",
      });
      option.addEventListener("mousedown", (event) => event.preventDefault());
      option.addEventListener("click", () => this.select(editor, completion));
      binding.list.append(option);
    }
    const rect = editor.getBoundingClientRect();
    binding.list.style.left = `${Math.max(8, Math.min(innerWidth - 428, rect.left))}px`;
    binding.list.style.top = `${Math.min(innerHeight - 280, rect.bottom + 3)}px`;
    binding.list.style.display = "block";
    editor.setAttribute("aria-expanded", "true");
  }

  onKeydown(event, editor) {
    const binding = this.bindings.get(editor);
    const options = [...(binding?.list.querySelectorAll("button") ?? [])];
    if (!options.length || binding.list.style.display === "none") return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.hide(editor);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Enter", "Tab"].includes(event.key)) return;
    event.preventDefault();
    if (["Enter", "Tab"].includes(event.key)) {
      this.select(editor, options[Math.max(0, binding.active)].textContent);
      return;
    }
    binding.active = (binding.active + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
    options.forEach((option, index) => {
      option.style.background = index === binding.active ? "Highlight" : "transparent";
      option.style.color = index === binding.active ? "HighlightText" : "inherit";
      option.setAttribute("aria-selected", String(index === binding.active));
    });
    options[binding.active].scrollIntoView({ block: "nearest" });
  }

  select(editor, completion) {
    const range = pdqlCompletionRange(editor.value, editor.selectionStart);
    if (!range) return;
    editor.setRangeText(completion, range.start, range.end, "end");
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    editor.dispatchEvent(new Event("change", { bubbles: true }));
    this.hide(editor);
    editor.focus();
  }

  hide(editor) {
    const binding = this.bindings.get(editor);
    if (!binding) return;
    binding.list.style.display = "none";
    binding.active = -1;
    editor.setAttribute("aria-expanded", "false");
  }

  unmount() {
    for (const binding of this.bindings.values()) binding.destroy();
    this.bindings.clear();
  }
}
