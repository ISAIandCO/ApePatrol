export class ProcessSpatialIndex {
  constructor(cellSize = 80) {
    this.cellSize = cellSize;
    this.cells = new Map();
  }

  key(x, y) { return `${x}:${y}`; }

  rebuild(nodes, project, radiusForNode) {
    this.cells.clear();
    for (const node of nodes) {
      const point = project(node);
      const radius = radiusForNode(node);
      const entry = { node, x: point.x, y: point.y, radius };
      const minimumX = Math.floor((point.x - radius) / this.cellSize);
      const maximumX = Math.floor((point.x + radius) / this.cellSize);
      const minimumY = Math.floor((point.y - radius) / this.cellSize);
      const maximumY = Math.floor((point.y + radius) / this.cellSize);
      for (let cellX = minimumX; cellX <= maximumX; cellX += 1) {
        for (let cellY = minimumY; cellY <= maximumY; cellY += 1) {
          const key = this.key(cellX, cellY);
          const values = this.cells.get(key) ?? [];
          values.push(entry);
          this.cells.set(key, values);
        }
      }
    }
  }

  hit(x, y) {
    const cellX = Math.floor(x / this.cellSize);
    const cellY = Math.floor(y / this.cellSize);
    let nearest = null;
    let nearestDistance = Infinity;
    for (const entry of this.cells.get(this.key(cellX, cellY)) ?? []) {
      const distance = Math.hypot(entry.x - x, entry.y - y);
      if (distance <= entry.radius && distance < nearestDistance) {
        nearest = entry.node;
        nearestDistance = distance;
      }
    }
    return nearest;
  }
}
