const EXACT_REPULSION_LIMIT = 280;
const LARGE_GRAPH_NEIGHBORS = 24;
const NEIGHBOR_OFFSETS = Object.freeze([
  [-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1],
]);

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

export function applyRepulsion(nodes, alpha) {
  let comparisons = 0;
  if (nodes.length <= EXACT_REPULSION_LIMIT) {
    for (let firstIndex = 0; firstIndex < nodes.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < nodes.length; secondIndex += 1) {
        repelPair(nodes[firstIndex], nodes[secondIndex], alpha);
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
        repelPair(node, other, alpha * .5);
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

export function stabilizeForceNode(node, alpha, boundary, dragged = false) {
  if (![node.x, node.y, node.vx, node.vy].every(Number.isFinite)) {
    node.x = 0;
    node.y = 0;
    node.vx = 0;
    node.vy = 0;
  }
  node.x = Math.max(-boundary, Math.min(boundary, node.x));
  node.y = Math.max(-boundary, Math.min(boundary, node.y));
  node.vx += -node.x * .00035 * alpha;
  node.vy += -node.y * .00035 * alpha;
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
