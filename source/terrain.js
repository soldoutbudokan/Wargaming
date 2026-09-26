(function () {
  'use strict';

  const WIDTH = 1800, HEIGHT = 1200, CELL = 40;
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const ellipse = (x, y, f) => ((x - f.x) / f.rx) ** 2 + ((y - f.y) / f.ry) ** 2;
  const pointSegmentDistance2 = (x, y, a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return (x - a.x - t * dx) ** 2 + (y - a.y - t * dy) ** 2;
  };
  const segmentEllipseInterval = (ax, ay, bx, by, x, y, rx, ry) => {
    const ox = (ax - x) / rx, oy = (ay - y) / ry;
    const dx = (bx - ax) / rx, dy = (by - ay) / ry;
    const a = dx * dx + dy * dy, b = 2 * (ox * dx + oy * dy), c = ox * ox + oy * oy - 1;
    if (a < 1e-14) return c <= 0 ? [0, 1] : null;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;
    const root = Math.sqrt(discriminant);
    const start = Math.max(0, (-b - root) / (2 * a)), end = Math.min(1, (-b + root) / (2 * a));
    return start <= end ? [start, end] : null;
  };
  const segmentBoxInterval = (ax, ay, bx, by, minX, minY, maxX, maxY) => {
    let start = 0, end = 1;
    for (const [origin, delta, min, max] of [[ax, bx - ax, minX, maxX], [ay, by - ay, minY, maxY]]) {
      if (Math.abs(delta) < 1e-12) { if (origin < min || origin > max) return null; }
      else {
        const t1 = (min - origin) / delta, t2 = (max - origin) / delta;
        start = Math.max(start, Math.min(t1, t2)); end = Math.min(end, Math.max(t1, t2));
        if (start > end) return null;
      }
    }
    return [start, end];
  };

  // Terrain geometry is shared by movement, sight, combat, and the map renderer.
  class FieldTerrain {
    constructor(scenarioId) {
      this.scenarioId = scenarioId;
      this.width = WIDTH;
      this.height = HEIGHT;
      this.cellSize = CELL;
      this.forests = [];
      this.hills = [];
      this.waters = [];
      this.fords = [];
      this.muds = [];
      this.roads = [];
      if (scenarioId === 'cannae') {
        this.waters = [{
          kind: 'river', name: 'Aufidus River', width: 58,
          points: [{ x: 150, y: -80 }, { x: 190, y: 180 }, { x: 218, y: 360 },
            { x: 180, y: 560 }, { x: 132, y: 790 }, { x: 168, y: 1000 }, { x: 205, y: 1280 }]
        }];
        this.fords = [{ x: 180, y: 560, r: 76, name: 'Shallow river crossing' }];
        this.forests = [{ x: 1590, y: 135, rx: 135, ry: 85, name: 'Northern grove' },
          { x: 1595, y: 1080, rx: 140, ry: 75, name: 'Southern grove' }];
        this.hills = [{ x: 1410, y: 155, rx: 310, ry: 165, height: 18, name: 'Low rise' }];
      } else if (scenarioId === 'hastings') {
        this.hills = [{ x: 900, y: 430, rx: 680, ry: 220, height: 65, name: 'Senlac ridge' }];
        this.forests = [{ x: 140, y: 180, rx: 150, ry: 170, name: 'Western woodland' },
          { x: 1650, y: 150, rx: 170, ry: 180, name: 'Eastern woodland' },
          { x: 1570, y: 1060, rx: 190, ry: 120, name: 'Southern woodland' }];
        this.muds = [{ x: 820, y: 700, rx: 300, ry: 45, name: 'Wet low ground' }];
      } else if (scenarioId === 'austerlitz') {
        this.hills = [{ x: 950, y: 530, rx: 410, ry: 300, height: 82, name: 'Pratzen Heights' },
          { x: 385, y: 205, rx: 185, ry: 150, height: 33, name: 'Northern rise' }];
        this.waters = [{ kind: 'pond', x: 1450, y: 1020, rx: 240, ry: 96, name: 'Satschan ponds' },
          { kind: 'pond', x: 1680, y: 850, rx: 90, ry: 115, name: 'Frozen fishpond' }];
        this.forests = [{ x: 160, y: 155, rx: 125, ry: 110, name: 'Northern woodland' },
          { x: 1570, y: 140, rx: 180, ry: 100, name: 'Eastern woodland' }];
        this.muds = [{ x: 485, y: 740, rx: 140, ry: 250, name: 'Thawing marsh' },
          { x: 1210, y: 900, rx: 200, ry: 60, name: 'Muddy pond approach' }];
      }
      this._columns = WIDTH / CELL;
      this._rows = HEIGHT / CELL;
      this._nodes = [];
      this._pathCache = new Map();
      this._buildNavigation();
    }

    _waterAt(x, y) {
      for (const water of this.waters) {
        if (water.kind === 'pond') {
          if (ellipse(x, y, water) <= 1) return water;
        } else {
          const radius2 = (water.width / 2) ** 2;
          for (let i = 1; i < water.points.length; i++) {
            if (pointSegmentDistance2(x, y, water.points[i - 1], water.points[i]) <= radius2) return water;
          }
        }
      }
      return null;
    }

    sample(x, y) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > WIDTH || y > HEIGHT) {
        return { type: 'plain', name: 'Map boundary', blocked: true, speed: 0, cover: 0, elevation: 0 };
      }
      const water = this._waterAt(x, y);
      if (water) {
        const ford = water.kind === 'river' && this.fords.find(f => (x - f.x) ** 2 + (y - f.y) ** 2 <= f.r ** 2);
        return ford
          ? { type: 'ford', name: ford.name || 'Ford', blocked: false, speed: 0.48, cover: 0, elevation: 0 }
          : { type: 'water', name: water.name || 'Water', blocked: true, speed: 0, cover: 0, elevation: 0 };
      }
      let elevation = 0, hill = null;
      for (const feature of this.hills) {
        const q = ellipse(x, y, feature);
        if (q < 1) {
          const height = feature.height * (1 - q) ** 1.5;
          if (height > elevation) { elevation = height; hill = feature; }
        }
      }
      const base = { type: hill ? 'hill' : 'plain', name: hill ? hill.name : 'Open ground',
        blocked: false, speed: 1, cover: 0, elevation };
      for (const forest of this.forests) {
        if (ellipse(x, y, forest) <= 1) {
          return { ...base, type: 'forest', name: forest.name || 'Woodland', speed: 0.58, cover: 0.4 };
        }
      }
      for (const mud of this.muds) {
        if (ellipse(x, y, mud) <= 1) return { ...base, type: 'mud', name: mud.name || 'Mud', speed: 0.62 };
      }
      return base;
    }

    canTraverse(ax, ay, bx, by) {
      return this._traversable(ax, ay, bx, by);
    }

    // Analytic segment tests catch even a grazing shoreline that fixed steps miss.
    _traversable(ax, ay, bx, by) {
      if (this.sample(ax, ay).blocked || this.sample(bx, by).blocked) return false;
      const fords = this.fords.map(f => segmentEllipseInterval(ax, ay, bx, by, f.x, f.y, f.r, f.r))
        .filter(Boolean).sort((a, b) => a[0] - b[0]);
      const coveredByFord = interval => {
        if (!interval) return true;
        let cursor = interval[0];
        for (const ford of fords) {
          if (ford[1] < cursor) continue;
          if (ford[0] > cursor + 1e-10) return false;
          cursor = Math.max(cursor, ford[1]);
          if (cursor >= interval[1] - 1e-10) return true;
        }
        return false;
      };
      for (const water of this.waters) {
        if (water.kind === 'pond') {
          if (segmentEllipseInterval(ax, ay, bx, by, water.x, water.y, water.rx, water.ry)) return false;
          continue;
        }
        const radius = water.width / 2;
        for (let i = 1; i < water.points.length; i++) {
          const a = water.points[i - 1], b = water.points[i];
          const length = Math.hypot(b.x - a.x, b.y - a.y);
          const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
          const pax = (ax - a.x) * ux + (ay - a.y) * uy, pay = -(ax - a.x) * uy + (ay - a.y) * ux;
          const pbx = (bx - a.x) * ux + (by - a.y) * uy, pby = -(bx - a.x) * uy + (by - a.y) * ux;
          if (!coveredByFord(segmentBoxInterval(pax, pay, pbx, pby, 0, -radius, length, radius)) ||
            !coveredByFord(segmentEllipseInterval(ax, ay, bx, by, a.x, a.y, radius, radius)) ||
            !coveredByFord(segmentEllipseInterval(ax, ay, bx, by, b.x, b.y, radius, radius))) return false;
        }
      }
      return true;
    }

    _buildNavigation() {
      const columns = this._columns, rows = this._rows;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const x = (col + 0.5) * CELL, y = (row + 0.5) * CELL;
          this._nodes.push({ x, y, col, row, terrain: this.sample(x, y), edges: [] });
        }
      }
      for (let i = 0; i < this._nodes.length; i++) {
        const node = this._nodes[i];
        if (node.terrain.blocked) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const col = node.col + dx, row = node.row + dy;
            if (col < 0 || row < 0 || col >= columns || row >= rows) continue;
            const next = this._nodes[row * columns + col];
            if (next.terrain.blocked) continue;
            // Both orthogonal cells must be open before a diagonal is allowed.
            if (dx && dy && (this._nodes[node.row * columns + col].terrain.blocked ||
              this._nodes[row * columns + node.col].terrain.blocked)) continue;
            if (!this._traversable(node.x, node.y, next.x, next.y)) continue;
            const distance = CELL * (dx && dy ? Math.SQRT2 : 1);
            const uphill = Math.max(0, next.terrain.elevation - node.terrain.elevation);
            const speed = (node.terrain.speed + next.terrain.speed) / 2;
            node.edges.push({ to: row * columns + col, cost: distance / speed + uphill * 2.5 });
          }
        }
      }
    }

    _nearestNode(x, y) {
      const cx = clamp(Math.floor(x / CELL), 0, this._columns - 1);
      const cy = clamp(Math.floor(y / CELL), 0, this._rows - 1);
      let best = -1, bestDistance = Infinity;
      // Nearby centers with a clear connecting segment. Never snap across a river.
      for (let row = Math.max(0, cy - 2); row <= Math.min(this._rows - 1, cy + 2); row++) {
        for (let col = Math.max(0, cx - 2); col <= Math.min(this._columns - 1, cx + 2); col++) {
          const index = row * this._columns + col, node = this._nodes[index];
          if (node.terrain.blocked) continue;
          const distance = (x - node.x) ** 2 + (y - node.y) ** 2;
          if (distance < bestDistance && this._traversable(x, y, node.x, node.y)) {
            best = index;
            bestDistance = distance;
          }
        }
      }
      return best;
    }

    _snapTarget(x, y, sx, sy) {
      if (!this.sample(x, y).blocked) return { x, y };
      // A click on a shoreline resolves to nearby dry ground. Ties prefer the
      // issuing unit's bank, while a deliberate far-bank order still uses a ford.
      for (let radius = 8; radius <= 160; radius += 8) {
        let best = null, distance = Infinity;
        for (let step = 0; step < 32; step++) {
          const angle = step * Math.PI / 16;
          const point = { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
          if (this.sample(point.x, point.y).blocked) continue;
          const d = (point.x - sx) ** 2 + (point.y - sy) ** 2;
          if (d < distance) { best = point; distance = d; }
        }
        if (best) return best;
      }
      return null;
    }

    findPath(sx, sy, tx, ty) {
      if (![sx, sy, tx, ty].every(Number.isFinite) || this.sample(sx, sy).blocked) return [];
      tx = clamp(tx, 2, WIDTH - 2);
      ty = clamp(ty, 2, HEIGHT - 2);
      const target = this._snapTarget(tx, ty, sx, sy);
      if (!target) return [];
      if (Math.hypot(target.x - sx, target.y - sy) < 0.01) return [];
      if (this._traversable(sx, sy, target.x, target.y)) return [target];
      const start = this._nearestNode(sx, sy), goal = this._nearestNode(target.x, target.y);
      if (start < 0 || goal < 0) return [];
      const cacheKey = start + ':' + goal;
      let indices = this._pathCache.get(cacheKey);
      if (!indices) {
        indices = this._search(start, goal);
        if (!indices) return [];
        if (this._pathCache.size >= 96) this._pathCache.delete(this._pathCache.keys().next().value);
        this._pathCache.set(cacheKey, indices);
      }
      const rough = [{ x: sx, y: sy }, ...indices.map(i => ({ x: this._nodes[i].x, y: this._nodes[i].y })), target];
      const path = [];
      let cursor = 0;
      // Only remove intermediate points when the entire replacement is passable.
      while (cursor < rough.length - 1) {
        let next = rough.length - 1;
        while (next > cursor + 1 && !this._traversable(rough[cursor].x, rough[cursor].y, rough[next].x, rough[next].y)) next--;
        const point = rough[next];
        if (!this._traversable(rough[cursor].x, rough[cursor].y, point.x, point.y)) return [];
        if (Math.hypot(point.x - rough[cursor].x, point.y - rough[cursor].y) > 0.01) path.push({ x: point.x, y: point.y });
        cursor = next;
      }
      return path;
    }

    _search(start, goal) {
      const count = this._nodes.length, costs = new Float64Array(count);
      costs.fill(Infinity);
      costs[start] = 0;
      const parents = new Int32Array(count);
      parents.fill(-1);
      const closed = new Uint8Array(count), heap = [];
      const end = this._nodes[goal];
      const heuristic = index => Math.hypot(this._nodes[index].x - end.x, this._nodes[index].y - end.y);
      const push = item => {
        heap.push(item);
        let i = heap.length - 1;
        while (i > 0) {
          const p = (i - 1) >> 1;
          if (heap[p].f <= item.f) break;
          heap[i] = heap[p]; i = p;
        }
        heap[i] = item;
      };
      const pop = () => {
        const first = heap[0], last = heap.pop();
        if (heap.length) {
          let i = 0;
          while (i * 2 + 1 < heap.length) {
            let child = i * 2 + 1;
            if (child + 1 < heap.length && heap[child + 1].f < heap[child].f) child++;
            if (heap[child].f >= last.f) break;
            heap[i] = heap[child]; i = child;
          }
          heap[i] = last;
        }
        return first;
      };
      push({ index: start, f: heuristic(start) });
      while (heap.length) {
        const current = pop().index;
        if (closed[current]) continue;
        if (current === goal) {
          const path = [goal];
          while (path[path.length - 1] !== start) {
            const parent = parents[path[path.length - 1]];
            if (parent < 0) return null;
            path.push(parent);
          }
          return path.reverse();
        }
        closed[current] = 1;
        for (const edge of this._nodes[current].edges) {
          if (closed[edge.to]) continue;
          const cost = costs[current] + edge.cost;
          if (cost < costs[edge.to]) {
            costs[edge.to] = cost;
            parents[edge.to] = current;
            push({ index: edge.to, f: cost + heuristic(edge.to) });
          }
        }
      }
      return null;
    }

    lineOfSight(ax, ay, bx, by) {
      if (![ax, ay, bx, by].every(Number.isFinite)) return false;
      const from = this.sample(ax, ay), to = this.sample(bx, by);
      if (from.blocked || to.blocked) return false;
      const distance = Math.hypot(bx - ax, by - ay);
      if (distance < 1) return true;
      const steps = Math.max(2, Math.ceil(distance / 12));
      const startHeight = from.elevation + 6, endHeight = to.elevation + 6;
      let forestDepth = 0;
      for (let i = 1; i < steps; i++) {
        const t = i / steps, terrain = this.sample(ax + (bx - ax) * t, ay + (by - ay) * t);
        const rayHeight = startHeight + (endHeight - startHeight) * t;
        if (terrain.elevation > rayHeight) return false;
        // A few trees confer cover. Deep woodland blocks sight and direct fire.
        if (terrain.type === 'forest' && terrain.elevation + 16 > rayHeight) {
          forestDepth += distance / steps;
          if (forestDepth >= 55) return false;
        }
      }
      return true;
    }
  }

  window.FieldTerrain = FieldTerrain;
})();
