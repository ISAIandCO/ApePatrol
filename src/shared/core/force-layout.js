const EXACT_REPULSION_LIMIT = 280;
const LARGE_GRAPH_NEIGHBORS = 24;
const NEIGHBOR_OFFSETS = Object.freeze([
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1],
]);

export const DEFAULT_FORCE_SETTINGS = Object.freeze({
  attraction: .4,
  repulsion: 16,
  linkStrength: 1,
  linkDistance: 88,
});

const FORCE_SETTING_LIMITS = Object.freeze({
  attraction: [0, 1],
  repulsion: [0, 30],
  linkStrength: [0, 2],
  linkDistance: [40, 500],
});

export function normalizeForceSettings(settings = {}) {
  return Object.fromEntries(Object.entries(DEFAULT_FORCE_SETTINGS).map(([name, fallback]) => {
    const numeric = Number(settings?.[name]);
    const [minimum, maximum] = FORCE_SETTING_LIMITS[name];
    return [name, Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback];
  }));
}

export function hashNumber(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function repelPair(first, second, alpha) {
  let dx = second.x - first.x;
  let dy = second.y - first.y;
  let distanceSquared = dx * dx + dy * dy;
  if (distanceSquared < .01) {
    dx = ((hashNumber(first.id) % 13) - 6) / 10;
    dy = ((hashNumber(second.id) % 13) - 6) / 10;
    distanceSquared = dx * dx + dy * dy || 1;
  }
  const distance = Math.sqrt(distanceSquared);
  const minimum = first.radius + second.radius + 12;
  const collision = distance < minimum ? (minimum - distance) * .13 : 0;
  const charge = distance < 320 ? Math.min(2.8, 950 / distanceSquared) : 0;
  const force = (collision + charge) * alpha;
  const forceX = (dx / distance) * force;
  const forceY = (dy / distance) * force;
  first.vx -= forceX;
  first.vy -= forceY;
  second.vx += forceX;
  second.vy += forceY;
}

export function applyRepulsion(nodes, alpha, strength = DEFAULT_FORCE_SETTINGS.repulsion) {
  const scaledAlpha = alpha * normalizeForceSettings({ repulsion: strength }).repulsion / DEFAULT_FORCE_SETTINGS.repulsion;
  let comparisons = 0;
  if (nodes.length <= EXACT_REPULSION_LIMIT) {
    for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
        repelPair(nodes[firstIndex], nodes[secondIndex], scaledAlpha);
        comparisons += 1;
      }
    }
    return comparisons;
  }

  const cellSize = 180;
  const cells = new Map();
  for (const node of nodes) {
    const cellX = Math.floor(node.x / cellSize);
    const cellY = Math.floor(node.y / cellSize);
    const key = `${cellX}:${cellY}`;
    const cell = cells.get(key) ?? [];
    cell.push(node);
    cells.set(key, cell);
  }

  for (const node of nodes) {
    const cellX = Math.floor(node.x / cellSize);
    const cellY = Math.floor(node.y / cellSize);
    const offsetStart = hashNumber(node.id) % NEIGHBOR_OFFSETS.length;
    let comparedForNode = 0;
    for (let offsetIndex = 0; offsetIndex < NEIGHBOR_OFFSETS.length && comparedForNode < LARGE_GRAPH_NEIGHBORS; offsetIndex += 1) {
      const [offsetX, offsetY] = NEIGHBOR_OFFSETS[(offsetStart + offsetIndex) % NEIGHBOR_OFFSETS.length];
      const candidates = cells.get(`${cellX + offsetX}:${cellY + offsetY}`) ?? [];
      if (!candidates.length) continue;
      const candidateStart = hashNumber(`${node.id}:${offsetX}:${offsetY}`) % candidates.length;
      for (let step = 0; step < candidates.length && comparedForNode < LARGE_GRAPH_NEIGHBORS; step += 1) {
        const other = candidates[(candidateStart + step) % candidates.length];
        if (other === node) continue;
        repelPair(node, other, scaledAlpha * .5);
        comparedForNode += 1;
        comparisons += 1;
      }
    }
  }
  return comparisons;
}

export function forceIterationLimit(nodeCount) {
  if (nodeCount <= EXACT_REPULSION_LIMIT) return 300;
  return Math.max(45, Math.round(300 * Math.sqrt(EXACT_REPULSION_LIMIT / nodeCount)));
}

function componentRoot(node, nodeMap) {
  const visited = new Set();
  let current = node;
  while (current?.parentId && nodeMap.has(current.parentId) && !visited.has(current.id)) {
    visited.add(current.id);
    current = nodeMap.get(current.parentId);
  }
  return current?.id ?? node.id;
}

function relativeDepth(node, nodeMap) {
  const visited = new Set();
  let current = node;
  let depth = 0;
  while (current?.parentId && nodeMap.has(current.parentId) && !visited.has(current.id)) {
    visited.add(current.id);
    current = nodeMap.get(current.parentId);
    depth += 1;
  }
  return depth;
}

export function seedComponentLayout(nodes, linkDistance = DEFAULT_FORCE_SETTINGS.linkDistance) {
  if (!Array.isArray(nodes) || !nodes.length) return 1_000;
  const distance = normalizeForceSettings({ linkDistance }).linkDistance;
  const horizontalGap = distance + 54;
  const verticalGap = distance + 76;
  const componentGap = distance * 2.5;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const components = new Map();
  for (const node of nodes) {
    const key = componentRoot(node, nodeMap);
    const component = components.get(key) ?? [];
    component.push(node);
    components.set(key, component);
  }

  const layouts = [...components.values()].map((component) => {
    const levels = new Map();
    for (const node of component) {
      const depth = relativeDepth(node, nodeMap);
      const level = levels.get(depth) ?? [];
      level.push(node);
      levels.set(depth, level);
    }
    const widest = Math.max(...[...levels.values()].map((level) => level.length));
    for (const [depth, level] of levels) {
      level.sort((first, second) => String(first.parentId ?? "").localeCompare(String(second.parentId ?? "")) || first.time - second.time || String(first.id).localeCompare(String(second.id)));
      for (let index = 0; index < level.length; index += 1) {
        const node = level[index];
        node.x = (index - (level.length - 1) / 2) * horizontalGap;
        node.y = depth * verticalGap;
        node.vx = 0;
        node.vy = 0;
      }
    }
    return {
      nodes: component,
      width: Math.max(horizontalGap, widest * horizontalGap),
      height: Math.max(verticalGap, levels.size * verticalGap),
      selected: component.some((node) => node.selected),
    };
  }).sort((first, second) => Number(second.selected) - Number(first.selected) || second.nodes.length - first.nodes.length);

  const targetRowWidth = Math.max(horizontalGap * 8, Math.sqrt(nodes.length) * horizontalGap * 2.4);
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const layout of layouts) {
    if (cursorX > 0 && cursorX + layout.width > targetRowWidth) {
      cursorX = 0;
      cursorY += rowHeight + componentGap;
      rowHeight = 0;
    }
    const offsetX = cursorX + layout.width / 2;
    for (const node of layout.nodes) {
      node.x += offsetX;
      node.y += cursorY;
    }
    cursorX += layout.width + componentGap;
    rowHeight = Math.max(rowHeight, layout.height);
  }

  const minimumX = Math.min(...nodes.map((node) => node.x));
  const maximumX = Math.max(...nodes.map((node) => node.x));
  const minimumY = Math.min(...nodes.map((node) => node.y));
  const maximumY = Math.max(...nodes.map((node) => node.y));
  const centerX = (minimumX + maximumX) / 2;
  const centerY = (minimumY + maximumY) / 2;
  let boundary = 1_000;
  for (const node of nodes) {
    node.x -= centerX;
    node.y -= centerY;
    node.anchorX = node.x;
    node.anchorY = node.y;
    boundary = Math.max(boundary, Math.abs(node.x) + componentGap, Math.abs(node.y) + componentGap);
  }
  return boundary;
}

export function stabilizeForceNode(node, alpha, boundary, dragged = false, attraction = DEFAULT_FORCE_SETTINGS.attraction) {
  if (![node.x, node.y, node.vx, node.vy].every(Number.isFinite)) {
    node.x = 0;
    node.y = 0;
    node.vx = 0;
    node.vy = 0;
  }
  node.x = Math.max(-boundary, Math.min(boundary, node.x));
  node.y = Math.max(-boundary, Math.min(boundary, node.y));
  const numericAttraction = Number(attraction);
  const attractionStrength = Number.isFinite(numericAttraction)
    ? Math.max(0, Math.min(1, numericAttraction))
    : DEFAULT_FORCE_SETTINGS.attraction;
  const anchorX = Number.isFinite(node.anchorX) ? node.anchorX : 0;
  const anchorY = Number.isFinite(node.anchorY) ? node.anchorY : 0;
  node.vx += (anchorX - node.x) * .000875 * attractionStrength * alpha;
  node.vy += (anchorY - node.y) * .000875 * attractionStrength * alpha;
  if (dragged) return;
  node.vx *= .82;
  node.vy *= .82;
  const speed = Math.hypot(node.vx, node.vy);
  if (speed > 40) {
    node.vx *= 40 / speed;
    node.vy *= 40 / speed;
  }
  node.x = Math.max(-boundary, Math.min(boundary, node.x + node.vx));
  node.y = Math.max(-boundary, Math.min(boundary, node.y + node.vy));
}
