import { eventDiffToMarkdown, compareEvents } from "../shared/event-compare.js";
import { setSafeText } from "../shared/dom.js";
import { sanitizeFilenamePart } from "../shared/url.js";
import { workspaceToJson, workspaceToMarkdown } from "../shared/workspace.js";
import { buildEqualityPredicate } from "../shared/pdql/builder.js";
import { buildEventSearchUrl } from "../siem/features/related-events.js";

const byId = (id) => document.getElementById(id);
const state = { workspaces: [], selectedId: null, compareIndexes: new Set(), compare: null };

function setStatus(message, error = false) {
  byId("workspace-status").textContent = message;
  byId("workspace-status").classList.toggle("error", error);
}

async function request(message) {
  const response = await browser.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error ?? "Workspace operation failed");
  return response;
}

function selectedWorkspace() { return state.workspaces.find((workspace) => workspace.id === state.selectedId) ?? null; }

function filteredWorkspaces() {
  const search = byId("workspace-search").value.trim().toLowerCase();
  const sort = byId("workspace-sort").value;
  return state.workspaces.filter((workspace) => !search || `${workspace.title} ${workspace.tags.join(" ")} ${workspace.notes}`.toLowerCase().includes(search))
    .sort(sort === "title" ? (first, second) => first.title.localeCompare(second.title, "ru")
      : sort === "created" ? (first, second) => second.createdAt - first.createdAt
        : (first, second) => second.updatedAt - first.updatedAt);
}

function renderList() {
  const list = byId("workspace-list");
  list.replaceChildren();
  for (const workspace of filteredWorkspaces()) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = workspace.id === state.selectedId ? "active" : "";
    const title = document.createElement("strong"); title.textContent = workspace.title;
    const metadata = document.createElement("span"); metadata.textContent = `${workspace.items.length} объектов · ${new Date(workspace.updatedAt).toLocaleString("ru-RU")}`;
    button.append(title, metadata);
    button.addEventListener("click", () => { state.selectedId = workspace.id; state.compareIndexes.clear(); render(); });
    list.append(button);
  }
  if (!list.children.length) list.textContent = "Расследования не найдены.";
}

function snapshotDetails(item) {
  const details = document.createElement("details");
  const summary = document.createElement("summary"); summary.textContent = "Локальный snapshot";
  const pre = document.createElement("pre"); pre.textContent = JSON.stringify(item.snapshot, null, 2);
  details.append(summary, pre);
  return details;
}

function eventUrl(workspace, item) {
  const uuid = item.sourceEventUuid ?? item.snapshot?.uuid;
  if (!uuid || !workspace.siemOrigin) return null;
  return buildEventSearchUrl(workspace.siemOrigin, buildEqualityPredicate("uuid", uuid), item.snapshot?.time, "15m");
}

function renderItems(workspace) {
  const list = byId("workspace-items");
  list.replaceChildren();
  workspace.items.forEach((item, index) => {
    const article = document.createElement("article");
    const heading = document.createElement("div"); heading.className = "item-heading";
    const title = document.createElement("h3"); title.textContent = `${item.type}: ${item.label}`;
    const actions = document.createElement("div"); actions.className = "item-actions";
    if (item.type === "event") {
      const label = document.createElement("label"); label.className = "compare-choice";
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.checked = state.compareIndexes.has(index);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked && state.compareIndexes.size >= 3) { checkbox.checked = false; setStatus("Для сравнения можно выбрать не более трёх событий", true); return; }
        if (checkbox.checked) state.compareIndexes.add(index); else state.compareIndexes.delete(index);
        renderCompare(workspace);
      });
      label.append(checkbox, document.createTextNode(" сравнить")); actions.append(label);
    }
    const url = eventUrl(workspace, item);
    if (url) {
      const open = document.createElement("button"); open.type = "button"; open.textContent = "Открыть событие";
      open.addEventListener("click", () => browser.runtime.sendMessage({ type: "tabs:open", url })); actions.append(open);
    }
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.textContent = "Удалить";
    remove.addEventListener("click", () => removeItem(index).catch((error) => setStatus(error.message, true))); actions.append(remove);
    heading.append(title, actions);
    const value = document.createElement("p"); value.textContent = item.value;
    article.append(heading, value, snapshotDetails(item));
    list.append(article);
  });
  if (!workspace.items.length) list.textContent = "Пока нет прикреплённых объектов. Используйте popup или правый клик по узлу графа.";
}

function renderCompare(workspace) {
  const panel = byId("compare-panel");
  const indexes = [...state.compareIndexes].sort((a, b) => a - b);
  panel.hidden = indexes.length < 2;
  if (indexes.length < 2) { state.compare = null; return; }
  const items = indexes.map((index) => workspace.items[index]);
  state.compare = compareEvents(items.map((item) => item.snapshot));
  byId("compare-event-3").hidden = state.compare.eventCount < 3;
  const tbody = byId("compare-body"); tbody.replaceChildren();
  for (const row of state.compare.rows) {
    const tr = document.createElement("tr");
    for (const value of [row.group, row.field, row.status, ...row.values.map((item) => item === undefined ? "—" : typeof item === "object" ? JSON.stringify(item) : String(item))]) {
      const td = document.createElement("td"); td.textContent = value; tr.append(td);
    }
    tbody.append(tr);
  }
  byId("compare-summary").textContent = `${state.compare.rows.filter((row) => row.status === "same").length} одинаковых · ${state.compare.rows.filter((row) => row.status === "changed").length} изменённых · ${state.compare.rows.filter((row) => row.status === "only").length} присутствуют не во всех событиях`;
}

function renderEditor() {
  const workspace = selectedWorkspace();
  byId("workspace-empty").hidden = Boolean(workspace);
  byId("workspace-editor").hidden = !workspace;
  if (!workspace) return;
  byId("workspace-title").value = workspace.title;
  byId("workspace-origin").textContent = workspace.siemOrigin ?? "SIEM origin не указан";
  byId("workspace-tags").value = workspace.tags.join(", ");
  byId("workspace-notes").value = workspace.notes;
  renderItems(workspace);
  renderCompare(workspace);
}

function render() { renderList(); renderEditor(); }

async function refresh({ selectId = state.selectedId } = {}) {
  const response = await request({ type: "workspace:list" });
  state.workspaces = response.workspaces;
  state.selectedId = state.workspaces.some((workspace) => workspace.id === selectId) ? selectId : state.workspaces[0]?.id ?? null;
  render();
}

async function createNew() {
  const response = await request({ type: "workspace:create", workspace: { title: "Новое расследование" } });
  state.compareIndexes.clear();
  await refresh({ selectId: response.workspace.id });
  byId("workspace-title").focus();
}

async function saveCurrent() {
  const workspace = selectedWorkspace();
  if (!workspace) return;
  const response = await request({
    type: "workspace:update",
    id: workspace.id,
    patch: {
      title: byId("workspace-title").value,
      tags: byId("workspace-tags").value.split(",").map((tag) => tag.trim()).filter(Boolean),
      notes: byId("workspace-notes").value,
    },
  });
  await refresh({ selectId: response.workspace.id });
  setStatus("Расследование сохранено локально");
}

async function deleteCurrent() {
  const workspace = selectedWorkspace();
  if (!workspace || !confirm(`Удалить расследование «${workspace.title}»? Это действие нельзя отменить.`)) return;
  await request({ type: "workspace:delete", id: workspace.id });
  state.compareIndexes.clear();
  await refresh({ selectId: null });
  setStatus("Расследование удалено");
}

async function removeItem(index) {
  const workspace = selectedWorkspace();
  await request({ type: "workspace:item:remove", id: workspace.id, index });
  state.compareIndexes.clear();
  await refresh({ selectId: workspace.id });
}

async function download(text, extension, mime) {
  const workspace = selectedWorkspace();
  const url = `data:${mime};charset=utf-8,${encodeURIComponent(text)}`;
  await browser.downloads.download({ url, filename: `apepatrol-${sanitizeFilenamePart(workspace.title) || workspace.id}.${extension}`, saveAs: true });
}

function compareLabels(workspace) { return [...state.compareIndexes].sort((a, b) => a - b).map((index) => workspace.items[index].label); }

byId("workspace-new").addEventListener("click", () => createNew().catch((error) => setStatus(error.message, true)));
byId("workspace-save").addEventListener("click", () => saveCurrent().catch((error) => setStatus(error.message, true)));
byId("workspace-delete").addEventListener("click", () => deleteCurrent().catch((error) => setStatus(error.message, true)));
byId("workspace-search").addEventListener("input", renderList);
byId("workspace-sort").addEventListener("change", renderList);
byId("export-json").addEventListener("click", () => download(workspaceToJson(selectedWorkspace()), "json", "application/json").catch((error) => setStatus(error.message, true)));
byId("export-markdown").addEventListener("click", () => download(workspaceToMarkdown(selectedWorkspace()), "md", "text/markdown").catch((error) => setStatus(error.message, true)));
byId("copy-compare-json").addEventListener("click", () => navigator.clipboard.writeText(JSON.stringify(state.compare, null, 2)).catch((error) => setStatus(error.message, true)));
byId("copy-compare-markdown").addEventListener("click", () => navigator.clipboard.writeText(eventDiffToMarkdown(state.compare, compareLabels(selectedWorkspace()))).catch((error) => setStatus(error.message, true)));

refresh().catch((error) => {
  setSafeText(byId("workspace-empty"), error.message);
  setStatus(error.message, true);
});
