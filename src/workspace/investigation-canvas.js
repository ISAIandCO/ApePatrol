import { applyRepulsion, DEFAULT_FORCE_SETTINGS, forceIterationLimit, normalizeForceSettings, stabilizeForceNode } from "../process-graph/force-layout.js";

const COLORS = Object.freeze({
  event: "#665cc7", host: "#2f7d68", account: "#b06b24", ip: "#2d74ad", process: "#9a4f8c",
  file: "#66717d", hash: "#a43f4c", domain: "#397d9b", session: "#7c61a8", incident: "#bd4a45",
});
const FORCE_STORAGE_KEY = "apepatrol.processGraph.forceSettings.v1";

function loadForceSettings() {
  try { return normalizeForceSettings(JSON.parse(localStorage.getItem(FORCE_STORAGE_KEY) ?? "{}")); }
  catch { return { ...DEFAULT_FORCE_SETTINGS }; }
}

function roundedRectangle(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

export class InvestigationCanvas {
  constructor(canvas, tooltip, { onSelectionChange, onEventOpen } = {}) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.tooltip = tooltip;
    this.onSelectionChange = onSelectionChange;
    this.onEventOpen = onEventOpen;
    this.nodes = [];
    this.edges = [];
    this.nodeMap = new Map();
    this.selectedIds = new Set();
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
    this.pan = null;
    this.pixelRatio = 1;
    this.forceSettings = loadForceSettings();
    this.alpha = 0;
    this.frame = null;
    this.iterations = 0;
    this.boundary = 1_000;
    this.fitWhenDone = false;
    this.bind();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
  }

  bind() {
    this.canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const point = this.point(event);
      const node = this.hit(point.x, point.y);
      this.pan = { x: point.x, y: point.y, offsetX: this.offsetX, offsetY: this.offsetY, node, moved: false };
      this.canvas.setPointerCapture(event.pointerId);
    });
    this.canvas.addEventListener("pointermove", (event) => {
      const point = this.point(event);
      if (this.pan) {
        if (Math.hypot(point.x - this.pan.x, point.y - this.pan.y) > 5) this.pan.moved = true;
        if (this.pan.moved && this.pan.node) {
          this.pan.node.x = (point.x - this.offsetX) / this.scale;
          this.pan.node.y = (point.y - this.offsetY) / this.scale;
          this.pan.node.anchorX = this.pan.node.x;
          this.pan.node.anchorY = this.pan.node.y;
          this.pan.node.vx = 0;
          this.pan.node.vy = 0;
          this.alpha = Math.max(this.alpha, .25);
          this.draw();
        } else if (this.pan.moved) {
          this.offsetX = this.pan.offsetX + point.x - this.pan.x;
          this.offsetY = this.pan.offsetY + point.y - this.pan.y;
          this.draw();
        }
      }
      const node = this.hit(point.x, point.y);
      this.canvas.classList.toggle("node-hover", Boolean(node));
      this.showTooltip(node, event.clientX, event.clientY);
    });
    this.canvas.addEventListener("pointerup", (event) => {
      const interaction = this.pan;
      this.pan = null;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      if (interaction?.node && interaction.moved) { this.startSimulation(); return; }
      if (!interaction?.node) return;
      if (interaction.node.kind === "entity" && interaction.node.queryFields?.length) {
        if (this.selectedIds.has(interaction.node.id)) this.selectedIds.delete(interaction.node.id);
        else this.selectedIds.add(interaction.node.id);
        this.draw();
        this.onSelectionChange?.(this.selectedNodes());
      } else if (interaction.node.kind === "event") this.onEventOpen?.(interaction.node);
    });
    this.canvas.addEventListener("pointercancel", () => { this.pan = null; this.startSimulation(); });
    this.canvas.addEventListener("pointerleave", () => { if (!this.pan) this.showTooltip(null); });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const point = this.point(event);
      const worldX = (point.x - this.offsetX) / this.scale;
      const worldY = (point.y - this.offsetY) / this.scale;
      this.scale = Math.max(.02, Math.min(3, this.scale * Math.exp(-event.deltaY * .0012)));
      this.offsetX = point.x - worldX * this.scale;
      this.offsetY = point.y - worldY * this.scale;
      this.draw();
    }, { passive: false });
  }

  resize() {
    const box = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, box.width);
    this.height = Math.max(1, box.height);
    this.pixelRatio = Math.min(2, devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.pixelRatio);
    this.canvas.height = Math.round(this.height * this.pixelRatio);
    this.fit();
  }

  point(event) {
    const box = this.canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  }

  selectedNodes() { return this.nodes.filter((node) => this.selectedIds.has(node.id)); }

  clearSelection() {
    this.selectedIds.clear();
    this.draw();
    this.onSelectionChange?.([]);
  }

  updateForceSetting(name, value) {
    this.forceSettings = normalizeForceSettings({ ...this.forceSettings, [name]: value });
    this.startSimulation();
    return this.forceSettings;
  }

  persistForceSettings() {
    try { localStorage.setItem(FORCE_STORAGE_KEY, JSON.stringify(this.forceSettings)); }
    catch { /* optional preference */ }
  }

  resetForceSettings() {
    this.forceSettings = { ...DEFAULT_FORCE_SETTINGS };
    this.persistForceSettings();
    this.layout();
    this.startSimulation({ fitWhenDone: true });
    return this.forceSettings;
  }

  setGraph(graph) {
    const previous = this.nodeMap;
    this.nodes = (graph?.nodes ?? []).map((node) => ({ ...node, radius: node.kind === "event" ? 16 : Math.min(18, 8 + Math.sqrt(node.connectionCount || 0) * 2) }));
    this.edges = graph?.edges ?? [];
    this.layout();
    for (const node of this.nodes) {
      const saved = previous.get(node.id);
      if (!saved || ![saved.x, saved.y].every(Number.isFinite)) continue;
      node.x = saved.x; node.y = saved.y; node.vx = 0; node.vy = 0;
      node.anchorX = Number.isFinite(saved.anchorX) ? saved.anchorX : saved.x;
      node.anchorY = Number.isFinite(saved.anchorY) ? saved.anchorY : saved.y;
    }
    this.nodeMap = new Map(this.nodes.map((node) => [node.id, node]));
    this.selectedIds = new Set([...this.selectedIds].filter((id) => this.nodeMap.has(id)));
    this.startSimulation({ fitWhenDone: true });
  }

  layout() {
    const events = this.nodes.filter((node) => node.kind === "event").sort((first, second) => (first.time ?? Infinity) - (second.time ?? Infinity));
    const eventOrder = new Map(events.map((node, index) => [node.id, index]));
    const connected = new Map(this.nodes.map((node) => [node.id, []]));
    for (const edge of this.edges) {
      connected.get(edge.sourceId)?.push(edge.targetId);
      connected.get(edge.targetId)?.push(edge.sourceId);
    }
    const entities = this.nodes.filter((node) => node.kind === "entity").sort((first, second) => {
      const average = (node) => {
        const positions = connected.get(node.id).map((id) => eventOrder.get(id)).filter(Number.isFinite);
        return positions.length ? positions.reduce((sum, value) => sum + value, 0) / positions.length : Infinity;
      };
      return average(first) - average(second) || first.entityType.localeCompare(second.entityType) || first.label.localeCompare(second.label, "ru");
    });
    const gap = 64;
    const height = Math.max(events.length, entities.length, 1) * gap;
    events.forEach((node, index) => { node.x = 250; node.y = index * gap - height / 2; });
    entities.forEach((node, index) => { node.x = -250; node.y = index * gap - height / 2; });
    for (const node of this.nodes) {
      node.vx = 0; node.vy = 0; node.anchorX = node.x; node.anchorY = node.y;
    }
    this.boundary = Math.max(1_000, height + 500);
  }

  startSimulation({ fitWhenDone = false } = {}) {
    if (!this.nodes.length) { this.alpha = 0; this.fitWhenDone = false; this.fit(); return; }
    this.alpha = 1;
    this.iterations = 0;
    this.fitWhenDone ||= fitWhenDone;
    this.scheduleSimulation();
  }

  scheduleSimulation() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const deadline = performance.now() + 10;
      const batch = this.nodes.length < 600 ? 8 : this.nodes.length < 2_500 ? 4 : 2;
      for (let step = 0; step < batch && this.alpha > .012 && performance.now() < deadline; step += 1) this.simulationStep();
      this.draw();
      if (this.alpha > .012) this.scheduleSimulation();
      else if (this.fitWhenDone) { this.fitWhenDone = false; this.fit(); }
    });
  }

  simulationStep() {
    for (const edge of this.edges) {
      const source = this.nodeMap.get(edge.sourceId);
      const target = this.nodeMap.get(edge.targetId);
      if (!source || !target) continue;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.hypot(dx, dy) || 1;
      const desired = this.forceSettings.linkDistance + source.radius + target.radius;
      const force = ((distance - desired) / distance) * .035 * this.forceSettings.linkStrength * this.alpha;
      source.vx += dx * force; source.vy += dy * force;
      target.vx -= dx * force; target.vy -= dy * force;
    }
    applyRepulsion(this.nodes, this.alpha, this.forceSettings.repulsion);
    for (const node of this.nodes) stabilizeForceNode(node, this.alpha, this.boundary, this.pan?.node === node, this.forceSettings.attraction);
    this.alpha *= .982;
    this.iterations += 1;
    if (this.iterations >= forceIterationLimit(this.nodes.length)) this.alpha = 0;
  }

  fit() {
    if (!this.width || !this.nodes.length) { this.draw(); return; }
    const minimumX = Math.min(...this.nodes.map((node) => node.x - 90));
    const maximumX = Math.max(...this.nodes.map((node) => node.x + 90));
    const minimumY = Math.min(...this.nodes.map((node) => node.y - 24));
    const maximumY = Math.max(...this.nodes.map((node) => node.y + 24));
    this.scale = Math.max(.02, Math.min(1.5, (this.width - 48) / Math.max(1, maximumX - minimumX), (this.height - 48) / Math.max(1, maximumY - minimumY)));
    this.offsetX = this.width / 2 - ((minimumX + maximumX) / 2) * this.scale;
    this.offsetY = this.height / 2 - ((minimumY + maximumY) / 2) * this.scale;
    this.draw();
  }

  screen(node) { return { x: node.x * this.scale + this.offsetX, y: node.y * this.scale + this.offsetY }; }

  hit(x, y) {
    for (let index = this.nodes.length - 1; index >= 0; index -= 1) {
      const node = this.nodes[index];
      const point = this.screen(node);
      if (Math.hypot(x - point.x, y - point.y) <= Math.max(10, node.radius * this.scale + 4)) return node;
    }
    return null;
  }

  showTooltip(node, clientX, clientY) {
    this.tooltip.hidden = !node;
    if (!node) return;
    this.tooltip.replaceChildren();
    const title = document.createElement("strong"); title.textContent = node.kind === "event" ? node.label : `${node.typeLabel}: ${node.label}`;
    const details = document.createElement("span"); details.textContent = node.kind === "event"
      ? `${node.time ? new Date(node.time).toLocaleString("ru-RU") : "Время неизвестно"}\n${node.description}`
      : `${node.connectionCount} связей${node.queryFields?.length ? " · нажмите для фильтра поиска" : ""}`;
    this.tooltip.append(title, details);
    this.tooltip.style.left = `${Math.max(8, Math.min(innerWidth - 330, clientX + 14))}px`;
    this.tooltip.style.top = `${Math.max(8, Math.min(innerHeight - 130, clientY + 14))}px`;
  }

  draw() {
    if (!this.context || !this.width) return;
    const context = this.context;
    context.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    context.clearRect(0, 0, this.width, this.height);
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    context.lineWidth = 1;
    context.strokeStyle = dark ? "rgba(220,215,235,.25)" : "rgba(70,62,92,.22)";
    for (const edge of this.edges) {
      const source = this.nodeMap.get(edge.sourceId);
      const target = this.nodeMap.get(edge.targetId);
      if (!source || !target) continue;
      const first = this.screen(source); const second = this.screen(target);
      context.beginPath(); context.moveTo(first.x, first.y); context.lineTo(second.x, second.y); context.stroke();
    }
    context.font = "12px system-ui, sans-serif";
    for (const node of this.nodes) {
      const point = this.screen(node);
      const radius = Math.max(5, node.radius * this.scale);
      context.fillStyle = COLORS[node.kind === "event" ? "event" : node.entityType] ?? "#66717d";
      if (node.kind === "event") {
        roundedRectangle(context, point.x - radius, point.y - radius, radius * 2, radius * 2, Math.max(4, radius / 3)); context.fill();
      } else {
        context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fill();
      }
      if (this.selectedIds.has(node.id)) {
        context.strokeStyle = dark ? "#fff" : "#1d1730"; context.lineWidth = 3;
        context.beginPath(); context.arc(point.x, point.y, radius + 4, 0, Math.PI * 2); context.stroke();
      }
      if (this.nodes.length <= 80 || this.selectedIds.has(node.id)) {
        const label = node.label.length > 34 ? `${node.label.slice(0, 31)}…` : node.label;
        context.fillStyle = dark ? "#f4f1fb" : "#272233";
        context.textAlign = node.kind === "event" ? "left" : "right";
        context.textBaseline = "middle";
        context.fillText(label, point.x + (node.kind === "event" ? radius + 7 : -radius - 7), point.y);
      }
    }
  }
}
