import { buildEqualityPredicate } from "../shared/pdql/builder.js";
import { buildEventSearchUrl } from "../siem/features/related-events.js";
import { buildProcessGraphView } from "../siem/process/view-model.js";
import { applyRepulsion, DEFAULT_FORCE_SETTINGS, forceIterationLimit, normalizeForceSettings, seedComponentLayout, stabilizeForceNode } from "./force-layout.js";
import { ProcessSpatialIndex } from "./spatial-index.js";
import { compileProcessTextFilter, filterProcessNodes, processFilterError } from "../siem/process/filters.js";

const byId = (id) => document.getElementById(id);
const canvas = byId("process-canvas");
const context = canvas.getContext("2d");
const tooltip = byId("process-tooltip");
const params = new URLSearchParams(location.search);
let sourceTabId = Number(params.get("tabId"));
const snapshotId = params.get("snapshotId");
const FORCE_STORAGE_KEY = "apepatrol.processGraph.forceSettings.v1";

function loadForceSettings() {
  try { return normalizeForceSettings(JSON.parse(localStorage.getItem(FORCE_STORAGE_KEY) ?? "{}")); }
  catch { return { ...DEFAULT_FORCE_SETTINGS }; }
}

const state = {
  graph: null,
  origin: null,
  nodes: [],
  edges: [],
  nodeMap: new Map(),
  layout: ["force", "timeline", "step"].includes(params.get("layout")) ? params.get("layout") : "force",
  width: 1,
  height: 1,
  pixelRatio: 1,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  alpha: 0,
  frame: null,
  hovered: null,
  dragNode: null,
  pan: null,
  pointerDown: null,
  tooltipPinned: false,
  search: "",
  searchMatcher: () => true,
  spatialIndex: new ProcessSpatialIndex(),
  spatialDirty: true,
  simulationIterations: 0,
  autoFitPending: false,
  stale: false,
  snapshotCreatedAt: null,
  visibleNodeIds: new Set(),
  filters: { relations: "all", hideIsolated: false },
  response: null,
  activeRequestId: null,
  nodeLimit: 1000,
  sliderRange: { from: null, to: null },
  forceSettings: loadForceSettings(),
  layoutBoundary: 1000,
};

function usesForceLayout() { return state.layout !== "timeline"; }

function visibleNodes() { return state.nodes.filter((node) => state.visibleNodeIds.has(node.id)); }

function updateVisibleNodes() {
  const selectedId = state.nodes.find((node) => node.selected)?.id ?? null;
  state.visibleNodeIds = filterProcessNodes(state.nodes, state.filters, selectedId);
  state.spatialDirty = true;
  const invalid = processFilterError(state.filters);
  byId("filter-count").textContent = invalid
    ? `Некорректное регулярное выражение: ${invalid.message}`
    : `Показано ${state.visibleNodeIds.size} из ${state.nodes.length} процессов`;
  scheduleDraw();
}

function setStatus(message, error = false) {
  byId("status").textContent = message;
  byId("status").classList.toggle("error", error);
}

function seedForceLayout() {
  state.layoutBoundary = seedComponentLayout(state.nodes, state.forceSettings.linkDistance);
}

function seedTimelineLayout() {
  const times = state.nodes.map((node) => node.time).filter(Number.isFinite);
  const minimum = times.length ? Math.min(...times) : 0;
  const maximum = times.length ? Math.max(...times) : minimum + 1;
  const span = Math.max(1, maximum - minimum);
  const width = Math.max(700, Math.sqrt(state.nodes.length) * 150);
  const depthBuckets = new Map();
  for (const node of [...state.nodes].sort((a, b) => a.time - b.time)) {
    const bucket = depthBuckets.get(node.depth) ?? 0;
    depthBuckets.set(node.depth, bucket + 1);
    const normalized = (node.time - minimum) / span;
    node.x = (normalized - .5) * width;
    node.y = (node.depth - 2) * 100 + ((bucket % 5) - 2) * 12;
    node.vx = 0;
    node.vy = 0;
  }
}

function seedLayout() {
  if (state.layout === "timeline") seedTimelineLayout();
  else seedForceLayout();
  state.spatialDirty = true;
}

function worldToScreen(node) {
  return {
    x: node.x * state.scale + state.offsetX,
    y: node.y * state.scale + state.offsetY,
  };
}

function screenToWorld(x, y) {
  return {
    x: (x - state.offsetX) / state.scale,
    y: (y - state.offsetY) / state.scale,
  };
}

function scheduleDraw() {
  if (state.frame) return;
  state.frame = requestAnimationFrame(frame);
}

function resizeCanvas() {
  const rectangle = canvas.getBoundingClientRect();
  state.width = Math.max(1, rectangle.width);
  state.height = Math.max(1, rectangle.height);
  state.pixelRatio = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(state.width * state.pixelRatio);
  canvas.height = Math.round(state.height * state.pixelRatio);
  scheduleDraw();
}

function fitGraph() {
  const nodes = visibleNodes();
  if (!nodes.length) return;
  const minimumX = Math.min(...nodes.map((node) => node.x - node.radius));
  const maximumX = Math.max(...nodes.map((node) => node.x + node.radius));
  const minimumY = Math.min(...nodes.map((node) => node.y - node.radius));
  const maximumY = Math.max(...nodes.map((node) => node.y + node.radius));
  const graphWidth = Math.max(1, maximumX - minimumX);
  const graphHeight = Math.max(1, maximumY - minimumY);
  const padding = 72;
  state.scale = Math.max(.012, Math.min(2.2, (state.width - padding * 2) / graphWidth, (state.height - padding * 2) / graphHeight));
  state.offsetX = state.width / 2 - ((minimumX + maximumX) / 2) * state.scale;
  state.offsetY = state.height / 2 - ((minimumY + maximumY) / 2) * state.scale;
  state.spatialDirty = true;
  scheduleDraw();
}

function simulationStep() {
  const alpha = state.alpha;
  const boundary = state.layoutBoundary;
  for (const node of state.nodes) stabilizeForceNode(node, 0, boundary, true);
  for (const edge of state.edges) {
    const source = state.nodeMap.get(edge.sourceId);
    const target = state.nodeMap.get(edge.targetId);
    if (!source || !target) continue;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    const desired = state.forceSettings.linkDistance + source.radius + target.radius;
    const force = ((distance - desired) / distance) * .035 * state.forceSettings.linkStrength * alpha;
    source.vx += dx * force;
    source.vy += dy * force;
    target.vx -= dx * force;
    target.vy -= dy * force;
  }
  applyRepulsion(state.nodes, alpha, state.forceSettings.repulsion);
  for (const node of state.nodes) {
    stabilizeForceNode(node, alpha, boundary, node === state.dragNode, state.forceSettings.attraction);
  }
  state.alpha *= .982;
  state.simulationIterations += 1;
  if (state.simulationIterations >= forceIterationLimit(state.nodes.length)) state.alpha = 0;
  state.spatialDirty = true;
}

function simulationBatch() {
  const maximumSteps = state.nodes.length < 600 ? 8 : state.nodes.length < 2500 ? 4 : 2;
  const deadline = performance.now() + 10;
  for (let step = 0; step < maximumSteps && state.alpha > .012; step += 1) {
    simulationStep();
    if (performance.now() >= deadline) break;
  }
}

function themeColors() {
  const dark = matchMedia("(prefers-color-scheme: dark)").matches;
  return dark ? {
    background: "#16151d",
    grid: "rgba(255,255,255,.035)",
    edge: "rgba(184,178,214,.32)",
    edgeActive: "rgba(255,174,66,.78)",
    node: "#8278e8",
    nodeDim: "rgba(130,120,232,.24)",
    selected: "#ff9f2e",
    stroke: "#e7e2ff",
    text: "#f5f1ff",
  } : {
    background: "#f7f6fb",
    grid: "rgba(44,36,70,.045)",
    edge: "rgba(67,57,102,.28)",
    edgeActive: "rgba(198,108,0,.75)",
    node: "#665cc7",
    nodeDim: "rgba(102,92,199,.22)",
    selected: "#e67b00",
    stroke: "#ffffff",
    text: "#241f32",
  };
}

function drawGrid(colors) {
  const spacing = Math.max(24, 60 * state.scale);
  context.strokeStyle = colors.grid;
  context.lineWidth = 1;
  context.beginPath();
  const startX = ((state.offsetX % spacing) + spacing) % spacing;
  const startY = ((state.offsetY % spacing) + spacing) % spacing;
  for (let x = startX; x < state.width; x += spacing) {
    context.moveTo(x, 0);
    context.lineTo(x, state.height);
  }
  for (let y = startY; y < state.height; y += spacing) {
    context.moveTo(0, y);
    context.lineTo(state.width, y);
  }
  context.stroke();
}

function drawArrow(source, target, colors, active) {
  const from = worldToScreen(source);
  const to = worldToScreen(target);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.sqrt(dx * dx + dy * dy) || 1;
  const unitX = dx / distance;
  const unitY = dy / distance;
  const sourceRadius = source.radius * state.scale;
  const targetRadius = target.radius * state.scale;
  const startX = from.x + unitX * sourceRadius;
  const startY = from.y + unitY * sourceRadius;
  const endX = to.x - unitX * targetRadius;
  const endY = to.y - unitY * targetRadius;
  context.strokeStyle = active ? colors.edgeActive : colors.edge;
  context.fillStyle = active ? colors.edgeActive : colors.edge;
  context.lineWidth = active ? 2 : 1.15;
  context.beginPath();
  context.moveTo(startX, startY);
  context.lineTo(endX, endY);
  context.stroke();
  if (state.scale < .25) return;
  const arrowSize = Math.max(4, Math.min(8, 5 * state.scale));
  context.beginPath();
  context.moveTo(endX, endY);
  context.lineTo(endX - unitX * arrowSize - unitY * arrowSize * .65, endY - unitY * arrowSize + unitX * arrowSize * .65);
  context.lineTo(endX - unitX * arrowSize + unitY * arrowSize * .65, endY - unitY * arrowSize - unitX * arrowSize * .65);
  context.closePath();
  context.fill();
}

function truncateLabel(value, length = 30) {
  return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function drawNode(node, colors) {
  const point = worldToScreen(node);
  const radius = Math.max(2.2, node.radius * state.scale);
  const matches = !state.search || state.searchMatcher(node.searchText);
  const active = node.selected || node === state.hovered;
  context.fillStyle = node.selected ? colors.selected : matches ? colors.node : colors.nodeDim;
  context.strokeStyle = colors.stroke;
  context.lineWidth = active ? 2.8 : 1.2;
  context.beginPath();
  context.arc(point.x, point.y, radius, 0, Math.PI * 2);
  context.fill();
  if (radius > 3) context.stroke();
  if (node.selected) {
    context.strokeStyle = colors.selected;
    context.lineWidth = 2;
    context.beginPath();
    context.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
    context.stroke();
  }
  const showLabel = state.scale >= .48 && (active || matches && (state.visibleNodeIds.size < 140 || node.connectionCount > 1));
  if (!showLabel) return;
  const fontSize = Math.max(10, Math.min(14, 11 * Math.sqrt(state.scale)));
  context.font = `${active ? 650 : 500} ${fontSize}px system-ui, sans-serif`;
  context.fillStyle = colors.text;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.fillText(truncateLabel(node.label), point.x, point.y + radius + 7);
}

function draw() {
  context.setTransform(state.pixelRatio, 0, 0, state.pixelRatio, 0, 0);
  const colors = themeColors();
  context.fillStyle = colors.background;
  context.fillRect(0, 0, state.width, state.height);
  drawGrid(colors);
  for (const edge of state.edges) {
    if (!state.visibleNodeIds.has(edge.sourceId) || !state.visibleNodeIds.has(edge.targetId)) continue;
    const source = state.nodeMap.get(edge.sourceId);
    const target = state.nodeMap.get(edge.targetId);
    if (source && target) drawArrow(source, target, colors, source.selected || target.selected || source === state.hovered || target === state.hovered);
  }
  for (const node of visibleNodes()) drawNode(node, colors);
  if (state.spatialDirty) {
    state.spatialIndex.rebuild(visibleNodes(), worldToScreen, (node) => Math.max(7, node.radius * state.scale + 5));
    state.spatialDirty = false;
  }
}

function frame() {
  state.frame = null;
  if (usesForceLayout() && state.alpha > .012) simulationBatch();
  draw();
  if (usesForceLayout() && state.alpha > .012) scheduleDraw();
  else if (state.autoFitPending) {
    state.autoFitPending = false;
    fitGraph();
  }
}

function startSimulation({ fitWhenDone = false } = {}) {
  state.alpha = 1;
  state.simulationIterations = 0;
  state.autoFitPending = fitWhenDone;
  scheduleDraw();
}

function hitTest(x, y) {
  if (state.spatialDirty) {
    state.spatialIndex.rebuild(visibleNodes(), worldToScreen, (node) => Math.max(7, node.radius * state.scale + 5));
    state.spatialDirty = false;
  }
  return state.spatialIndex.hit(x, y);
}

function tooltipRow(label, value) {
  const row = document.createElement("div");
  row.className = "tooltip-row";
  const name = document.createElement("span");
  name.textContent = label;
  const content = document.createElement("strong");
  content.textContent = value;
  row.append(name, content);
  return row;
}

function closeTooltip() {
  state.tooltipPinned = false;
  tooltip.classList.remove("pinned");
  tooltip.hidden = true;
}

function showTooltip(node, clientX, clientY, { pinned = false } = {}) {
  if (state.tooltipPinned && !pinned) return;
  if (!node) {
    closeTooltip();
    return;
  }
  state.tooltipPinned = pinned;
  tooltip.classList.toggle("pinned", pinned);
  tooltip.replaceChildren();
  const title = document.createElement("h2");
  title.textContent = node.label;
  const relations = document.createElement("p");
  relations.textContent = `${node.connectionCount} связей · клик откроет событие в SIEM · правый клик закрепит карточку`;
  tooltip.append(title, relations);
  for (const item of node.details) tooltip.append(tooltipRow(item.label, item.value));
  if (pinned) {
    const actions = document.createElement("div");
    actions.className = "tooltip-actions";
    if (state.layout === "step") {
      for (const [direction, label] of [["parents", "Найти родителя"], ["children", "Найти дочерние"], ["both", "Найти оба направления"]]) {
        const expand = document.createElement("button");
        expand.type = "button";
        expand.textContent = label;
        expand.disabled = Boolean(state.activeRequestId) || state.stale;
        expand.addEventListener("click", () => expandNodeGraph(node, direction).catch((error) => setStatus(error.message, true)));
        actions.append(expand);
      }
    }
    const attach = document.createElement("button");
    attach.type = "button";
    attach.textContent = "Прикрепить процесс";
    attach.addEventListener("click", () => pinProcessNode(node).catch((error) => setStatus(error.message, true)));
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Закрыть карточку";
    close.addEventListener("click", closeTooltip);
    actions.append(attach, close);
    tooltip.append(actions);
  }
  tooltip.hidden = false;
  const margin = 14;
  const left = Math.min(innerWidth - tooltip.offsetWidth - margin, clientX + 16);
  const top = Math.min(innerHeight - tooltip.offsetHeight - margin, clientY + 16);
  tooltip.style.left = `${Math.max(margin, left)}px`;
  tooltip.style.top = `${Math.max(margin, top)}px`;
}

async function pinProcessNode(node) {
  const response = await browser.runtime.sendMessage({
    type: "workspace:item:add",
    siemOrigin: state.origin,
    sourceIncidentId: state.response?.sourceEvent?.incident_id ?? null,
    item: {
      type: "process",
      value: String(node.event?.uuid ?? node.id),
      label: node.label,
      sourceEventUuid: node.event?.uuid ?? null,
      snapshot: node.event,
    },
  });
  if (!response?.ok) throw new Error(response?.error ?? "Не удалось прикрепить процесс");
  setStatus(`Процесс прикреплён к «${response.workspace.title}»`);
}

async function openNodeEvent(node) {
  const uuid = node?.event?.uuid;
  if (!uuid || !state.origin) {
    setStatus("У процесса нет UUID события, поэтому открыть его в SIEM нельзя", true);
    return;
  }
  const url = buildEventSearchUrl(state.origin, buildEqualityPredicate("uuid", uuid), node.event.time, "15m");
  const response = await browser.runtime.sendMessage({ type: "tabs:open", url });
  if (!response?.ok) setStatus(response?.error ?? "Не удалось открыть событие", true);
}

function pointerPosition(event) {
  const rectangle = canvas.getBoundingClientRect();
  return { x: event.clientX - rectangle.left, y: event.clientY - rectangle.top };
}

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  state.autoFitPending = false;
  const position = pointerPosition(event);
  const node = hitTest(position.x, position.y);
  state.pointerDown = { x: position.x, y: position.y, moved: false, node };
  if (node) state.dragNode = node;
  else state.pan = { x: position.x, y: position.y, offsetX: state.offsetX, offsetY: state.offsetY };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  const position = pointerPosition(event);
  if (state.pointerDown && Math.hypot(position.x - state.pointerDown.x, position.y - state.pointerDown.y) > 5) state.pointerDown.moved = true;
  if (state.dragNode) {
    const world = screenToWorld(position.x, position.y);
    state.dragNode.x = world.x;
    state.dragNode.y = world.y;
    state.dragNode.vx = 0;
    state.dragNode.vy = 0;
    state.spatialDirty = true;
    state.alpha = Math.max(state.alpha, .25);
    scheduleDraw();
    return;
  }
  if (state.pan) {
    state.offsetX = state.pan.offsetX + position.x - state.pan.x;
    state.offsetY = state.pan.offsetY + position.y - state.pan.y;
    state.spatialDirty = true;
    scheduleDraw();
    return;
  }
  state.hovered = hitTest(position.x, position.y);
  canvas.classList.toggle("node-hover", Boolean(state.hovered));
  showTooltip(state.hovered, event.clientX, event.clientY);
  scheduleDraw();
});

canvas.addEventListener("pointerup", (event) => {
  if (event.button !== 0 || !state.pointerDown) return;
  const node = state.pointerDown?.node;
  const shouldOpen = node && !state.pointerDown.moved;
  state.dragNode = null;
  state.pan = null;
  state.pointerDown = null;
  if (usesForceLayout()) startSimulation();
  if (shouldOpen) openNodeEvent(node).catch((error) => setStatus(error.message, true));
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
});

canvas.addEventListener("pointercancel", () => {
  state.dragNode = null;
  state.pan = null;
  state.pointerDown = null;
});

canvas.addEventListener("pointerleave", () => {
  if (!state.dragNode && !state.pan) {
    state.hovered = null;
    if (!state.tooltipPinned) tooltip.hidden = true;
    canvas.classList.remove("node-hover");
    scheduleDraw();
  }
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  const position = pointerPosition(event);
  const world = screenToWorld(position.x, position.y);
  const factor = Math.exp(-event.deltaY * .0012);
  state.autoFitPending = false;
  state.scale = Math.max(.012, Math.min(4, state.scale * factor));
  state.offsetX = position.x - world.x * state.scale;
  state.offsetY = position.y - world.y * state.scale;
  state.spatialDirty = true;
  scheduleDraw();
}, { passive: false });

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const position = pointerPosition(event);
  const node = hitTest(position.x, position.y);
  if (node) showTooltip(node, event.clientX, event.clientY, { pinned: true });
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.tooltipPinned) closeTooltip();
});

function updateLayoutButtons() {
  for (const layout of ["force", "timeline", "step"]) {
    const button = byId(`layout-${layout}`);
    const active = state.layout === layout;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  }
  byId("force-controls").disabled = !usesForceLayout();
}

const forceControls = Object.freeze({
  attraction: { input: "force-attraction", output: "force-attraction-value", digits: 2 },
  repulsion: { input: "force-repulsion", output: "force-repulsion-value", digits: 2 },
  linkStrength: { input: "force-link-strength", output: "force-link-strength-value", digits: 2 },
  linkDistance: { input: "force-link-distance", output: "force-link-distance-value", digits: 0 },
});

function renderForceControls() {
  for (const [name, control] of Object.entries(forceControls)) {
    byId(control.input).value = String(state.forceSettings[name]);
    byId(control.output).value = state.forceSettings[name].toFixed(control.digits);
  }
}

function updateForceSetting(name, value, { fitWhenDone = false } = {}) {
  state.forceSettings = normalizeForceSettings({ ...state.forceSettings, [name]: value });
  renderForceControls();
  if (usesForceLayout() && state.nodes.length) startSimulation({ fitWhenDone });
}

function persistForceSettings() {
  try { localStorage.setItem(FORCE_STORAGE_KEY, JSON.stringify(state.forceSettings)); } catch { /* optional preference */ }
}

async function selectLayout(layout) {
  if (!["force", "timeline", "step"].includes(layout)) return;
  const requestedMode = layout === "step" ? "step" : "broad";
  const currentMode = state.response?.queryMetadata?.mode ?? "broad";
  if (requestedMode !== currentMode && (!Number.isInteger(sourceTabId) || sourceTabId <= 0 || state.stale)) {
    throw new Error("Для смены режима нужна подключённая SIEM-вкладка");
  }
  state.layout = layout;
  updateLayoutButtons();
  updateExpansionUi();
  if (requestedMode !== currentMode) {
    await reloadGraph();
    return;
  }
  seedLayout();
  if (usesForceLayout()) startSimulation({ fitWhenDone: true });
  else {
    state.alpha = 0;
    state.autoFitPending = false;
  }
  fitGraph();
}

function applyGraphResponse(response, { stale = false, snapshotCreatedAt = null } = {}) {
  const view = buildProcessGraphView(response.graph, response.sourceNodeId, response.sourceEvent);
  state.graph = response.graph;
  state.response = response;
  state.origin = response.origin;
  state.nodes = view.nodes;
  state.edges = view.edges;
  state.nodeMap = new Map(state.nodes.map((node) => [node.id, node]));
  updateVisibleNodes();
  state.stale = stale;
  state.snapshotCreatedAt = snapshotCreatedAt;
  state.nodeLimit = Number(response.queryMetadata?.maxNodes) || state.nodeLimit;
  const expansionStep = String(response.queryMetadata?.expansionStepSeconds ?? "");
  if ([...byId("expand-step").options].some((option) => option.value === expansionStep)) byId("expand-step").value = expansionStep;
  byId("loading").hidden = true;
  byId("empty").hidden = state.nodes.length > 0;
  canvas.hidden = state.nodes.length === 0;
  if (!state.nodes.length) {
    setStatus("События запуска процессов за выбранный интервал не найдены");
    return;
  }
  const selected = state.nodes.some((node) => node.selected);
  const truncated = response.graph?.truncated ? " · достигнут лимит узлов" : "";
  const staleLabel = state.stale ? " · локальный снимок, источник SIEM недоступен" : "";
  const partialLabel = response.queryMetadata?.partial ? " · частичный граф" : "";
  setStatus(`${state.nodes.length} процессов · ${state.edges.length} parent/child-связей${selected ? " · исходный процесс выделен" : " · исходный процесс не сопоставлен"}${truncated}${partialLabel}${staleLabel}`);
  updateExpansionUi();
  updateTimeSliders();
  seedLayout();
  if (usesForceLayout()) startSimulation({ fitWhenDone: true });
  requestAnimationFrame(fitGraph);
}

function markGraphStale(message = "Исходная вкладка SIEM закрыта; текущий локальный снимок продолжает работать") {
  state.stale = true;
  setStatus(message);
  updateExpansionUi();
}

function updateExpansionUi() {
  const loading = Boolean(state.activeRequestId);
  const sourceAvailable = Number.isInteger(sourceTabId) && sourceTabId > 0 && !state.stale;
  const stepMode = state.layout === "step";
  document.querySelectorAll("[data-expand]").forEach((button) => {
    button.hidden = stepMode;
    button.disabled = loading || !sourceAvailable;
  });
  byId("expand-step-label").firstChild.textContent = stepMode ? "Диапазон поиска у узла " : "Шаг ";
  byId("cancel-expand").disabled = !loading;
  byId("reload-graph").disabled = loading || !sourceAvailable;
  byId("reconnect-graph").hidden = sourceAvailable;
  const limitReached = Boolean(state.response?.queryMetadata?.limitReached || state.graph?.truncated);
  byId("continue-limit").hidden = stepMode || !limitReached || state.nodeLimit >= 10_000 || !sourceAvailable;
  byId("partial-indicator").hidden = !state.response?.queryMetadata?.partial;
  const metadata = state.response?.queryMetadata;
  byId("graph-range").textContent = metadata?.timeFrom && metadata?.timeTo
    ? `${new Date(metadata.timeFrom).toLocaleString("ru-RU")} — ${new Date(metadata.timeTo).toLocaleString("ru-RU")}`
    : "Диапазон не загружен";
}

async function persistCurrentSnapshot() {
  if (!snapshotId || !state.response) return;
  const saved = await browser.runtime.sendMessage({
    type: "graph:snapshot:update",
    id: snapshotId,
    snapshot: { sourceTabId, sourceEvent: state.response.sourceEvent, response: state.response },
  });
  if (!saved?.ok) throw new Error(saved?.error ?? "Не удалось обновить снимок графа");
}

async function expandGraph(direction, { nodeLimit = state.nodeLimit, resumeLimit = false } = {}) {
  if (state.activeRequestId) return;
  if (!Number.isInteger(sourceTabId) || sourceTabId <= 0 || state.stale) throw new Error("Сначала подключите доступную SIEM-вкладку");
  const requestId = crypto.randomUUID();
  state.activeRequestId = requestId;
  state.nodeLimit = Math.min(10_000, Math.max(state.nodeLimit, Number(nodeLimit) || state.nodeLimit));
  updateExpansionUi();
  byId("loading").hidden = false;
  setStatus("Подгружаю дополнительный контекст процессов…");
  try {
    const response = await browser.tabs.sendMessage(sourceTabId, {
      type: "siem:process:expand",
      requestId,
      direction,
      resumeLimit,
      stepSeconds: Number(byId("expand-step").value),
      nodeLimit: state.nodeLimit,
      sourceEvent: state.response.sourceEvent,
      queryMetadata: state.response.queryMetadata,
      existingEvents: state.graph.nodes.map((node) => node.event),
    });
    if (!response?.ok) throw new Error(response?.error ?? "Не удалось расширить граф");
    applyGraphResponse(response);
    await persistCurrentSnapshot();
  } finally {
    state.activeRequestId = null;
    byId("loading").hidden = true;
    updateExpansionUi();
  }
}

async function expandNodeGraph(node, direction) {
  if (state.activeRequestId) return;
  if (state.layout !== "step") throw new Error("Точечное расширение доступно в пошаговом режиме");
  if (!Number.isInteger(sourceTabId) || sourceTabId <= 0 || state.stale) throw new Error("Сначала подключите доступную SIEM-вкладку");
  const requestId = crypto.randomUUID();
  state.activeRequestId = requestId;
  updateExpansionUi();
  byId("loading").hidden = false;
  setStatus(`Ищу ${direction === "parents" ? "родителя" : direction === "children" ? "дочерние процессы" : "родителя и дочерние процессы"} для ${node.label}…`);
  try {
    const response = await browser.tabs.sendMessage(sourceTabId, {
      type: "siem:process:expand-node",
      requestId,
      direction,
      stepSeconds: Number(byId("expand-step").value),
      nodeLimit: state.nodeLimit,
      nodeEvent: node.event,
      sourceEvent: state.response.sourceEvent,
      queryMetadata: state.response.queryMetadata,
      existingEvents: state.graph.nodes.map((item) => item.event),
    });
    if (!response?.ok) throw new Error(response?.error ?? "Не удалось расширить цепочку процесса");
    applyGraphResponse(response);
    await persistCurrentSnapshot();
  } finally {
    state.activeRequestId = null;
    byId("loading").hidden = true;
    updateExpansionUi();
  }
}

async function cancelExpansion() {
  if (!state.activeRequestId || !Number.isInteger(sourceTabId)) return;
  const requestId = state.activeRequestId;
  await browser.tabs.sendMessage(sourceTabId, { type: "siem:process:cancel", requestId });
  setStatus("Отмена запроса процессов запрошена");
}

async function reconnectGraph() {
  if (!state.origin) throw new Error("В снимке отсутствует SIEM origin");
  const tabs = await browser.tabs.query({ url: `${state.origin}/*` });
  const candidate = tabs.find((tab) => tab.active) ?? tabs[0];
  if (!candidate?.id) throw new Error(`Нет открытой вкладки ${state.origin}`);
  const contextResponse = await browser.tabs.sendMessage(candidate.id, { type: "siem:get-context" });
  if (!contextResponse?.ok || contextResponse.origin !== state.origin) throw new Error("Выбранная вкладка не отвечает как настроенный MP SIEM");
  sourceTabId = candidate.id;
  state.stale = false;
  updateExpansionUi();
  setStatus("Граф подключён к доступной SIEM-вкладке; можно продолжить подгрузку");
}

function sliderBounds() {
  const times = state.nodes.map((node) => node.time).filter(Number.isFinite);
  if (!times.length) return { from: null, to: null };
  const minimum = Math.min(...times);
  const maximum = Math.max(...times);
  const start = Math.min(Number(byId("time-slider-start").value), Number(byId("time-slider-end").value));
  const end = Math.max(Number(byId("time-slider-start").value), Number(byId("time-slider-end").value));
  const span = maximum - minimum;
  return { from: minimum + span * start / 100, to: minimum + span * end / 100 };
}

function updateTimeSliders() {
  state.sliderRange = sliderBounds();
  byId("time-slider-label").textContent = state.sliderRange.from === null ? ""
    : `${new Date(state.sliderRange.from).toLocaleString("ru-RU")} — ${new Date(state.sliderRange.to).toLocaleString("ru-RU")}`;
}

async function loadSnapshot() {
  if (!snapshotId) return false;
  const result = await browser.runtime.sendMessage({ type: "graph:snapshot:get", id: snapshotId });
  if (!result?.ok) throw new Error(result?.error ?? "Не удалось загрузить снимок графа");
  if (!result.snapshot) return false;
  applyGraphResponse(result.snapshot.response, { snapshotCreatedAt: result.snapshot.createdAt });
  if (Number.isInteger(sourceTabId) && sourceTabId > 0) {
    try { await browser.tabs.get(sourceTabId); } catch { markGraphStale(); }
  } else {
    markGraphStale("Граф загружен из локального снимка без привязанной вкладки SIEM");
  }
  return true;
}

async function reloadGraph() {
  if (!Number.isInteger(sourceTabId) || sourceTabId <= 0) {
    if (state.nodes.length) {
      markGraphStale("Нельзя обновить данные: исходная вкладка SIEM недоступна");
      return false;
    }
    throw new Error("Не передан идентификатор вкладки MaxPatrol SIEM");
  }
  byId("loading").hidden = false;
  setStatus("Получаю события процессов из MaxPatrol SIEM…");
  try {
    const response = await browser.tabs.sendMessage(sourceTabId, { type: "siem:process", mode: state.layout === "step" ? "step" : "broad" });
    if (!response?.ok) throw new Error(response?.error ?? "Расширение не получило данные процессов");
    applyGraphResponse(response);
    await persistCurrentSnapshot();
    return true;
  } catch (error) {
    byId("loading").hidden = true;
    if (state.nodes.length) {
      markGraphStale(`Не удалось обновить данные (${error.message}); текущий снимок сохранён`);
      return false;
    }
    throw error;
  }
}

async function initializeGraph() {
  byId("loading").hidden = false;
  setStatus("Загружаю локальный снимок графа…");
  let snapshotLoaded = false;
  try { snapshotLoaded = await loadSnapshot(); } catch (error) { setStatus(`Снимок недоступен: ${error.message}`); }
  if (!snapshotLoaded) await reloadGraph();
}

byId("layout-force").addEventListener("click", () => selectLayout("force").catch((error) => setStatus(error.message, true)));
byId("layout-timeline").addEventListener("click", () => selectLayout("timeline").catch((error) => setStatus(error.message, true)));
byId("layout-step").addEventListener("click", () => selectLayout("step").catch((error) => setStatus(error.message, true)));
byId("fit-graph").addEventListener("click", fitGraph);
byId("reload-graph").addEventListener("click", () => reloadGraph().catch((error) => {
  byId("loading").hidden = true;
  setStatus(error.message, true);
}));
byId("reconnect-graph").addEventListener("click", () => reconnectGraph().catch((error) => setStatus(error.message, true)));
byId("open-workspace").addEventListener("click", () => browser.tabs.create({ url: browser.runtime.getURL("workspace.html") }));
for (const button of document.querySelectorAll("[data-expand]")) {
  button.addEventListener("click", () => expandGraph(button.dataset.expand).catch((error) => setStatus(error.message, true)));
}
byId("cancel-expand").addEventListener("click", () => cancelExpansion().catch((error) => setStatus(error.message, true)));
byId("continue-limit").addEventListener("click", () => expandGraph(state.response?.queryMetadata?.lastDirection ?? "both", { nodeLimit: 10_000, resumeLimit: true }).catch((error) => setStatus(error.message, true)));
byId("process-search").addEventListener("input", (event) => {
  state.search = event.target.value.trim();
  const compiled = compileProcessTextFilter(state.search);
  state.searchMatcher = compiled.test;
  event.target.setAttribute("aria-invalid", String(Boolean(compiled.error)));
  scheduleDraw();
});
for (const [name, control] of Object.entries(forceControls)) {
  byId(control.input).addEventListener("input", (event) => updateForceSetting(name, event.target.value));
  byId(control.input).addEventListener("change", () => {
    persistForceSettings();
    startSimulation({ fitWhenDone: true });
  });
}
byId("force-reset").addEventListener("click", () => {
  state.forceSettings = { ...DEFAULT_FORCE_SETTINGS };
  renderForceControls();
  persistForceSettings();
  seedForceLayout();
  startSimulation({ fitWhenDone: true });
});

function readFilters() {
  const timeValue = (id) => {
    const value = byId(id).value;
    const parsed = value ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? parsed : null;
  };
  state.filters = {
    name: byId("filter-process-name").value.trim(),
    path: byId("filter-process-path").value.trim(),
    account: byId("filter-account").value.trim(),
    pid: byId("filter-pid").value.trim(),
    host: byId("filter-host").value.trim(),
    eventType: byId("filter-event-type").value.trim(),
    eventText: byId("filter-event-text").value.trim(),
    relations: byId("filter-relations").value,
    hideIsolated: byId("filter-hide-isolated").checked,
    timeFrom: timeValue("filter-time-from") ?? state.sliderRange.from,
    timeTo: timeValue("filter-time-to") ?? state.sliderRange.to,
  };
  const invalid = processFilterError(state.filters);
  const fieldIds = { name: "filter-process-name", path: "filter-process-path", account: "filter-account", pid: "filter-pid", host: "filter-host", eventType: "filter-event-type", eventText: "filter-event-text" };
  for (const id of Object.values(fieldIds)) byId(id).removeAttribute("aria-invalid");
  if (invalid) byId(fieldIds[invalid.field]).setAttribute("aria-invalid", "true");
  updateVisibleNodes();
}

for (const id of ["time-slider-start", "time-slider-end"]) {
  byId(id).addEventListener("input", () => {
    updateTimeSliders();
    readFilters();
  });
}

for (const id of ["filter-process-name", "filter-process-path", "filter-account", "filter-pid", "filter-host", "filter-event-type", "filter-event-text", "filter-time-from", "filter-time-to"]) {
  byId(id).addEventListener("input", readFilters);
}
byId("filter-relations").addEventListener("change", readFilters);
byId("filter-hide-isolated").addEventListener("change", readFilters);
byId("filter-reset").addEventListener("click", () => {
  for (const id of ["filter-process-name", "filter-process-path", "filter-account", "filter-pid", "filter-host", "filter-event-type", "filter-event-text", "filter-time-from", "filter-time-to"]) byId(id).value = "";
  byId("filter-relations").value = "all";
  byId("filter-hide-isolated").checked = false;
  byId("time-slider-start").value = "0";
  byId("time-slider-end").value = "100";
  updateTimeSliders();
  readFilters();
});

new ResizeObserver(resizeCanvas).observe(canvas.parentElement);
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", scheduleDraw);
browser.tabs.onRemoved.addListener((tabId) => {
  if (tabId === sourceTabId && state.nodes.length) markGraphStale();
});
updateLayoutButtons();
renderForceControls();
updateExpansionUi();
resizeCanvas();
initializeGraph().catch((error) => {
  byId("loading").hidden = true;
  byId("empty").hidden = false;
  byId("empty").textContent = error.message;
  setStatus(error.message, true);
});
