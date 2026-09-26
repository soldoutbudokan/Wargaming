(function (global) {
  'use strict';

  const WIDTH = 1800;
  const HEIGHT = 1200;
  const TAU = Math.PI * 2;
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const viable = (f) => f.count > 0 && f.status !== 'routing' && f.status !== 'defeated';
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angleDistance = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

  const ROSTERS = {
    cannae: [
      [
        ['Iberian horse', 'cavalry'], ['Libyan spears', 'infantry'], ['Gallic warriors', 'infantry'],
        ['Iberian swords', 'infantry'], ['African veterans', 'infantry'], ['Numidian horse', 'cavalry'],
        ['Hasdrubal’s cavalry', 'cavalry'], ['Balearic slingers', 'archers'], ['Carthaginian reserve', 'infantry'],
        ['Libyan reserve', 'infantry'], ['Light skirmishers', 'archers'], ['Maharbal’s horse', 'cavalry']
      ],
      [
        ['Roman cavalry', 'cavalry'], ['First legion', 'infantry'], ['Second legion', 'infantry'],
        ['Third legion', 'infantry'], ['Fourth legion', 'infantry'], ['Allied cavalry', 'cavalry'],
        ['Latin allies', 'infantry'], ['Velites', 'archers'], ['Veteran triarii', 'infantry'],
        ['Allied infantry', 'infantry'], ['Roman skirmishers', 'archers'], ['Italian reserve', 'infantry']
      ]
    ],
    hastings: [
      [
        ['Breton knights', 'cavalry'], ['Breton infantry', 'infantry'], ['Norman men-at-arms', 'infantry'],
        ['Ducal guard', 'infantry'], ['French infantry', 'infantry'], ['Norman knights', 'cavalry'],
        ['Breton horse', 'cavalry'], ['Norman bowmen', 'archers'], ['Norman reserve', 'infantry'],
        ['French bowmen', 'archers'], ['Flemish bowmen', 'archers'], ['William’s knights', 'cavalry']
      ],
      [
        ['Western fyrd', 'infantry'], ['Housecarls', 'infantry'], ['Royal housecarls', 'infantry'],
        ['Harold’s guard', 'infantry'], ['Kentish fyrd', 'infantry'], ['Eastern fyrd', 'infantry'],
        ['Sussex levy', 'infantry'], ['English bowmen', 'archers'], ['London fyrd', 'infantry'],
        ['Wessex reserve', 'infantry'], ['Saxon skirmishers', 'archers'], ['Northern levy', 'infantry']
      ]
    ],
    austerlitz: [
      [
        ['Light cavalry', 'cavalry'], ['Saint-Hilaire’s division', 'infantry'], ['Vandamme’s division', 'infantry'],
        ['Davout’s infantry', 'infantry'], ['Lannes’ infantry', 'infantry'], ['French cuirassiers', 'cavalry'],
        ['Imperial cavalry', 'cavalry'], ['French voltigeurs', 'infantry'], ['Imperial Guard', 'infantry'],
        ['Bernadotte’s reserve', 'infantry'], ['French artillery', 'artillery'], ['French dragoons', 'cavalry']
      ],
      [
        ['Austrian cavalry', 'cavalry'], ['Russian first column', 'infantry'], ['Russian second column', 'infantry'],
        ['Austrian infantry', 'infantry'], ['Allied center', 'infantry'], ['Russian cavalry', 'cavalry'],
        ['Russian dragoons', 'cavalry'], ['Russian skirmishers', 'infantry'], ['Russian Guard', 'infantry'],
        ['Allied reserve', 'infantry'], ['Allied artillery', 'artillery'], ['Guard cavalry', 'cavalry']
      ]
    ]
  };

  function hashString(value) {
    let hash = 2166136261;
    for (let i = 0; i < value.length; i++) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  class BattleEngine {
    constructor(scenario = {}, total = 10000) {
      this.scenario = scenario;
      this.scenarioId = String(scenario.id || 'cannae').toLowerCase();
      this.time = 0;
      this.winner = null;
      this.formations = [];
      this.effects = [];
      this.timeLimit = 600;
      this.resultReason = null;
      this._effectId = 0;
      this.terrain = typeof global.FieldTerrain === 'function' ? new global.FieldTerrain(this.scenarioId) : {
        sample: () => ({type: 'plain', name: 'Open ground', blocked: false, speed: 1, cover: 0, elevation: 0}),
        findPath: (sx, sy, tx, ty) => [{x: tx, y: ty}],
        lineOfSight: () => true
      };
      this.seed = Number.isFinite(scenario.seed) ? scenario.seed >>> 0 : hashString(this.scenarioId);
      this.randomState = this.seed || 1;
      this._aiClock = 0;
      this.width = WIDTH;
      this.height = HEIGHT;
      const size = Number.isFinite(+total) ? clamp(Math.floor(+total), 0, 100000) : 10000;
      const ratio = Number.isFinite(+scenario.ratio) ? clamp(+scenario.ratio, 0, 1) : 0.5;
      const friendlySize = Math.round(size * ratio);
      const sizes = [friendlySize, size - friendlySize];
      this.friendlyInitial = sizes[0];
      this.enemyInitial = sizes[1];
      const roster = ROSTERS[this.scenarioId] || ROSTERS.cannae;

      for (let team = 0; team < 2; team++) {
        const weights = roster[team].map(([, type]) => type === 'artillery' ? 0.2 : type === 'cavalry' ? 0.8 : type === 'archers' ? 0.75 : 1.2);
        const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
        const allocations = weights.map(weight => Math.floor(sizes[team] * weight / weightSum));
        let remainder = sizes[team] - allocations.reduce((sum, n) => sum + n, 0);
        for (let i = 0; remainder > 0; i = (i + 1) % 12, remainder--) allocations[i]++;
        for (let index = 0; index < 12; index++) {
          const row = Math.floor(index / 6);
          const col = index % 6;
          const [name, type] = roster[team][index];
          const initial = allocations[index];
          let x = 300 + col * 240;
          let y = team === 0 ? 790 + row * 120 : 410 - row * 120;
          if (this.scenarioId === 'cannae' && team === 0) {
            if (type === 'cavalry') x += col < 3 ? -85 : 85;
            if (!row) y -= (2.5 - Math.abs(col - 2.5)) * 24;
          }
          if (this.scenarioId === 'hastings' && team === 1) y -= 32;
          if (this.scenarioId === 'austerlitz') x += team === 0 ? -35 : 35;
          if (this.terrain.sample(x, y).blocked) {
            const spawn = this._nearestGround(x, y);
            x = spawn.x; y = spawn.y;
          }
          const weapon = type === 'artillery' ? 'cannon' : this.scenarioId === 'austerlitz' && type !== 'cavalry' ? 'musket' :
            type === 'archers' ? (this.scenarioId === 'cannae' ? 'sling' : 'bow') :
              /spear|triarii|fyrd|levy/i.test(name) ? 'spear' : 'sword';
          const profile = {
            cannon: [580, 16, 13], musket: [285, 32, 8], bow: [315, 24, 6], sling: [290, 28, 5.5], spear: [0, 0, 0], sword: [0, 0, 0]
          }[weapon];
          const formation = {
            id: team * 12 + index,
            team, name, type, x, y,
            angle: team === 0 ? -Math.PI / 2 : Math.PI / 2,
            width: type === 'cavalry' ? 124 : 142,
            depth: type === 'cavalry' ? 66 : 58,
            initial, count: initial,
            morale: initial ? 100 : 0,
            fatigue: 0, cohesion: initial ? 100 : 0,
            weapon, range: profile[0], ammo: profile[1], maxAmmo: profile[1],
            reload: 0, reloadDuration: profile[2],
            terrain: 'Open ground', terrainType: 'plain', cover: 0, elevation: 0,
            momentum: 0,
            status: initial ? 'holding' : 'defeated',
            targetX: x, targetY: y, targetId: null,
            stance: 'line',
            speed: type === 'cavalry' ? 56 : type === 'artillery' ? 18 : type === 'archers' ? 35 : 30,
            command: 'hold',
            kills: 0,
            chargeTime: 0,
            combatTargetId: null,
            _lossFraction: 0,
            _killFraction: 0,
            _path: [], _pathClock: 0, _plannedX: NaN, _plannedY: NaN,
            _moved: 0, _impactClock: 0, _underFire: 0,
            _skill: 0.91 + this.random() * 0.18,
            _homeX: x,
            _homeY: y,
            _baseWidth: type === 'cavalry' ? 124 : 142,
            _baseDepth: type === 'cavalry' ? 66 : 58
          };
          // The Cannae roster trades fewer troops for mobile, experienced formations.
          if (this.scenarioId === 'cannae' && team === 0) formation._skill *= 1.15;
          if (this.scenarioId === 'hastings' && team === 1) formation._skill *= 1.04;
          this._sampleFormation(formation);
          this.formations.push(formation);
        }
      }
      this._checkWinner();
    }

    random() {
      let t = this.randomState += 0x6D2B79F5;
      t = Math.imul(t ^ t >>> 15, t | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      this.randomState >>>= 0;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    _nearestGround(x, y) {
      for (let radius = 0; radius <= 240; radius += 12) {
        for (let angle = 0; angle < TAU; angle += Math.PI / 8) {
          const px = clamp(x + Math.cos(angle) * radius, 20, WIDTH - 20);
          const py = clamp(y + Math.sin(angle) * radius, 20, HEIGHT - 20);
          if (!this.terrain.sample(px, py).blocked) return {x: px, y: py};
        }
      }
      return {x, y};
    }

    _sampleFormation(f) {
      const terrain = this.terrain.sample(f.x, f.y);
      f.terrain = terrain.name;
      f.terrainType = terrain.type;
      f.cover = terrain.cover;
      f.elevation = terrain.elevation;
      return terrain;
    }

    _clearPath(ax, ay, bx, by) {
      if (typeof this.terrain.canTraverse === 'function') return this.terrain.canTraverse(ax, ay, bx, by);
      if (typeof this.terrain._traversable === 'function') return this.terrain._traversable(ax, ay, bx, by);
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
      for (let i = 1; i <= steps; i++) {
        if (this.terrain.sample(ax + (bx - ax) * i / steps, ay + (by - ay) * i / steps).blocked) return false;
      }
      return true;
    }

    _planPath(f) {
      f._path = this._clearPath(f.x, f.y, f.targetX, f.targetY) ? [{x: f.targetX, y: f.targetY}] :
        this.terrain.findPath(f.x, f.y, f.targetX, f.targetY).map(p => ({x: p.x, y: p.y}));
      f._plannedX = f.targetX;
      f._plannedY = f.targetY;
      f._pathClock = 1.2;
      if (f.command === 'move' && f._path.length) {
        const endpoint = f._path[f._path.length - 1];
        f.targetX = endpoint.x; f.targetY = endpoint.y;
      }
    }

    _position(f, x, y) {
      x = clamp(x, 15, WIDTH - 15); y = clamp(y, 15, HEIGHT - 15);
      if (!this._clearPath(f.x, f.y, x, y)) return false;
      f._moved += Math.hypot(x - f.x, y - f.y);
      f.x = x; f.y = y;
      return true;
    }

    _friendlyObstruction(f, target) {
      const dx = target.x - f.x, dy = target.y - f.y;
      const lengthSquared = dx * dx + dy * dy;
      if (!lengthSquared) return false;
      for (const ally of this.formations) {
        if (ally === f || ally.team !== f.team || !viable(ally)) continue;
        const projection = ((ally.x - f.x) * dx + (ally.y - f.y) * dy) / lengthSquared;
        if (projection < 0.04 || projection > 0.94) continue;
        // Arcing arrows clear distant friendly ranks; firearms need an open lane.
        if ((f.weapon === 'bow' || f.weapon === 'sling') && projection * Math.sqrt(lengthSquared) > 85) continue;
        const separation = Math.hypot(ally.x - f.x - projection * dx, ally.y - f.y - projection * dy);
        if (separation < Math.min(ally.width, ally.depth) * 0.45 + 8) return true;
      }
      return false;
    }

    _canFire(f, target) {
      if (!f.range || f.ammo <= 0 || distance(f, target) > f.range) return false;
      const bearing = Math.atan2(target.y - f.y, target.x - f.x);
      const arc = f.stance === 'square' ? Math.PI : f.weapon === 'cannon' ? 0.55 : f.weapon === 'musket' ? 0.8 : 1.05;
      return angleDistance(bearing, f.angle) <= arc &&
        this.terrain.lineOfSight(f.x, f.y, target.x, target.y) && !this._friendlyObstruction(f, target);
    }

    _emit(type, f, target, life) {
      this.effects.push({id: ++this._effectId, type, x: f.x, y: f.y, tx: target.x, ty: target.y, time: this.time, life});
    }

    _selected(ids) {
      const selected = new Set(Array.isArray(ids) ? ids : [ids]);
      return this.formations.filter(f => f.team === 0 && selected.has(f.id) && viable(f));
    }

    order(ids, x, y, targetId = null) {
      if (this.winner || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const selected = this._selected(ids);
      if (!selected.length) return;
      const target = this.formations.find(f => f.id === targetId && f.team === 1 && viable(f));
      const centerX = selected.reduce((sum, f) => sum + f.x, 0) / selected.length;
      const centerY = selected.reduce((sum, f) => sum + f.y, 0) / selected.length;
      const spreadX = Math.max(1, ...selected.map(f => Math.abs(f.x - centerX)));
      const spreadY = Math.max(1, ...selected.map(f => Math.abs(f.y - centerY)));
      const scale = Math.min(1, 450 / spreadX, 180 / spreadY);
      for (const f of selected) {
        f.targetX = clamp(x + (f.x - centerX) * scale, 65, WIDTH - 65);
        f.targetY = clamp(y + (f.y - centerY) * scale, 65, HEIGHT - 65);
        f.targetId = target ? target.id : null;
        f.command = target ? 'attack' : 'move';
        f.status = 'moving';
        f.chargeTime = 0;
        f._pathClock = 0; f._path = []; f._plannedX = NaN;
      }
    }

    hold(ids) {
      for (const f of this._selected(ids)) {
        f.targetX = f.x;
        f.targetY = f.y;
        f.targetId = null;
        f.command = 'hold';
        f.status = 'holding';
        f.chargeTime = 0;
        f._path = []; f.momentum = 0;
      }
    }

    charge(ids) {
      if (this.winner) return;
      for (const f of this._selected(ids)) {
        const enemy = this._nearest(f);
        if (!enemy) continue;
        f.targetId = enemy.id;
        f.targetX = enemy.x;
        f.targetY = enemy.y;
        f.command = f.type === 'artillery' ? 'attack' : 'charge';
        f.status = f.type === 'artillery' ? 'moving' : 'charging';
        f.chargeTime = f.type === 'artillery' ? 0 : 1;
        f._pathClock = 0; f._path = []; f._plannedX = NaN;
      }
    }

    setFormation(ids, stance) {
      if (!['line', 'column', 'square'].includes(stance)) return;
      for (const f of this._selected(ids)) {
        if (stance === 'square' && f.weapon !== 'musket') continue;
        if (f.stance !== stance) f.cohesion = Math.max(30, f.cohesion - 8);
        f.stance = stance;
        if (stance === 'square') {
          f.width = f.depth = Math.sqrt(f._baseWidth * f._baseDepth);
        } else if (stance === 'column') {
          f.width = f._baseWidth * 0.5;
          f.depth = f._baseDepth * 2;
        } else {
          f.width = f._baseWidth;
          f.depth = f._baseDepth;
        }
      }
    }

    _nearest(f) {
      let result = null;
      let best = Infinity;
      for (const enemy of this.formations) {
        if (enemy.team === f.team || !viable(enemy)) continue;
        const d = distance(f, enemy);
        if (d < best) { result = enemy; best = d; }
      }
      return result;
    }

    _ai() {
      for (const f of this.formations) {
        if (f.team !== 1 || !viable(f)) continue;
        let target = this._nearest(f);
        if (!target) continue;
        if (this.scenarioId === 'hastings') {
          // English infantry protects the ridge and makes only short counterattacks.
          const counterattack = f.type !== 'archers' && distance(f, target) < 190 && target.y < 580;
          if (!counterattack) {
            f.targetId = null;
            f.targetX = f._homeX;
            f.targetY = f._homeY;
            f.command = Math.hypot(f.x - f._homeX, f.y - f._homeY) > 8 ? 'move' : 'hold';
            continue;
          }
        }
        if (this.scenarioId === 'austerlitz' && this.time < 80) {
          const wing = f.id % 6;
          if (wing === 2 && distance(f, target) > 225) {
            // A thin reserve stays on the heights as the southern columns advance.
            f.targetId = null;
            f.command = 'hold';
            f.targetX = f.x;
            f.targetY = f.y;
            continue;
          }
          if (wing >= 3) {
            let best = Infinity;
            for (const candidate of this.formations) {
              if (candidate.team !== 0 || !viable(candidate)) continue;
              const score = distance(f, candidate) - Math.max(0, candidate.x - 900) * 0.8;
              if (score < best) { best = score; target = candidate; }
            }
          }
        }
        f.targetId = target.id;
        f.command = 'attack';
        f.targetX = target.x;
        f.targetY = target.y;
      }
    }

    _separate(dt) {
      for (let i = 0; i < this.formations.length; i++) {
        const a = this.formations[i];
        if (!viable(a)) continue;
        for (let j = i + 1; j < this.formations.length; j++) {
          const b = this.formations[j];
          if (a.team !== b.team || !viable(b)) continue;
          const moveA = a.command !== 'hold';
          const moveB = b.command !== 'hold';
          if (!moveA && !moveB) continue;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d = Math.hypot(dx, dy);
          const spacing = Math.min(125, (a.width + b.width) * 0.3 + (a.depth + b.depth) * 0.2);
          if (d >= spacing) continue;
          if (d < 0.01) {
            dx = Math.cos((a.id + b.id) * 2.4);
            dy = Math.sin((a.id + b.id) * 2.4);
            d = 1;
          }
          const correction = Math.min(spacing - d, 12 * dt) / (moveA && moveB ? 2 : 1);
          if (moveA) {
            this._position(a, a.x + dx / d * correction, a.y + dy / d * correction);
          }
          if (moveB) {
            this._position(b, b.x - dx / d * correction, b.y - dy / d * correction);
          }
        }
      }
    }

    _meleeRange(a, b) {
      return 28 + (a.depth + b.depth) * 0.32 + (a.width + b.width) * 0.13;
    }

    _move(f, dt) {
      f.combatTargetId = null;
      f._moved = 0;
      f._pathClock -= dt;
      f.reload = Math.max(0, f.reload - dt / (1 + f.fatigue * 0.006));
      f._impactClock = Math.max(0, f._impactClock - dt);
      f._underFire = Math.max(0, f._underFire - dt);
      if (f.status === 'defeated') return;
      const routing = f.status === 'routing';
      let target = f.targetId === null ? null : this.formations[f.targetId];
      if (target && (!viable(target) || target.team === f.team)) {
        target = f.command === 'attack' || f.command === 'charge' ? this._nearest(f) : null;
        f.targetId = target ? target.id : null;
      }
      if (target) {
        f.targetX = target.x;
        f.targetY = target.y;
      }
      if (routing) {
        target = null;
        f.targetY = f.team === 0 ? HEIGHT - 20 : 20;
        if (!Number.isFinite(f._retreatX)) f._retreatX = f.x;
        f.targetX = f._retreatX;
      }
      const terrain = this._sampleFormation(f);
      if (f.command === 'hold') { f.status = 'holding'; f.momentum = Math.max(0, f.momentum - dt); return; }
      const targetDistance = Math.hypot(f.targetX - f.x, f.targetY - f.y);
      const canStandOff = target && f.range && f.ammo > 0 && f.command !== 'charge' && this.terrain.lineOfSight(f.x, f.y, target.x, target.y);
      const stopDistance = target ? (canStandOff ? f.range * 0.78 : this._meleeRange(f, target) * 0.86) : 3;
      if (targetDistance <= stopDistance && (!target || this._clearPath(f.x, f.y, target.x, target.y) || canStandOff)) {
        if (target) {
          const bearing = Math.atan2(target.y - f.y, target.x - f.x);
          const turn = Math.atan2(Math.sin(bearing - f.angle), Math.cos(bearing - f.angle));
          f.angle += clamp(turn, -dt, dt);
        }
        if (!routing) f.status = target ? 'attacking' : 'holding';
        if (!target && !routing) f.command = 'hold';
        f.momentum = Math.max(0, f.momentum - dt * 0.32);
        return;
      }
      const drift = Math.hypot(f.targetX - f._plannedX, f.targetY - f._plannedY);
      if (!Number.isFinite(f._plannedX) || (f._pathClock <= 0 && (drift > 45 || !f._path.length))) this._planPath(f);
      while (f._path.length && Math.hypot(f._path[0].x - f.x, f._path[0].y - f.y) < 5) f._path.shift();
      const point = f._path[0];
      if (!point) { f.momentum = 0; if (!routing) f.status = 'holding'; return; }
      const dx = point.x - f.x, dy = point.y - f.y;
      const d = Math.hypot(dx, dy);
      const desired = Math.atan2(dy, dx);
      const turn = Math.atan2(Math.sin(desired - f.angle), Math.cos(desired - f.angle));
      f.angle = (f.angle + clamp(turn, -1.6 * dt, 1.6 * dt)) % TAU;
      const charging = f.command === 'charge' && f.type !== 'artillery' && f.fatigue < 82;
      f.chargeTime = charging ? 1 : 0;
      const stanceSpeed = f.stance === 'square' ? 0.48 : f.stance === 'column' ? 1.18 : 1;
      const terrainSpeed = terrain.speed * (f.type === 'cavalry' && terrain.cover > 0.2 ? 0.7 : 1);
      const nextTerrain = this.terrain.sample(point.x, point.y);
      const uphill = clamp(1 - Math.max(0, nextTerrain.elevation - terrain.elevation) / Math.max(60, d) * 0.9, 0.58, 1);
      const speed = f.speed * stanceSpeed * (charging ? 1.35 : routing ? 1.15 : 1) * terrainSpeed * uphill *
        (1 - f.fatigue * 0.0045) * (0.65 + f.cohesion * 0.0035) * clamp(1 - Math.abs(turn) / Math.PI * 0.65, 0.35, 1);
      const finalStep = f._path.length === 1 && (!target || this._clearPath(f.x, f.y, f.targetX, f.targetY));
      const step = Math.max(0, Math.min(d, finalStep ? Math.max(0, targetDistance - stopDistance) : d, speed * dt));
      if (!this._position(f, f.x + dx / d * step, f.y + dy / d * step)) { f._path = []; f._pathClock = 0; }
      f.momentum = clamp(f.momentum + (charging && f.type === 'cavalry' && terrain.cover < 0.2 ? dt * 0.16 : -dt * 0.35), 0, 1);
      if (!routing) f.status = charging ? 'charging' : 'moving';
    }

    update(dt) {
      if (this.winner || !Number.isFinite(dt) || dt <= 0) return;
      dt = Math.min(dt, 0.05);
      this.time += dt;
      this.effects = this.effects.filter(effect => this.time - effect.time < effect.life);
      this._aiClock -= dt;
      if (this._aiClock <= 0) { this._ai(); this._aiClock = 0.7; }
      for (const f of this.formations) this._move(f, dt);
      this._separate(dt);

      const damage = new Float64Array(24);
      const pressure = new Float64Array(24);
      const disruption = new Float64Array(24);
      const engaged = new Uint8Array(24);
      const tempo = this.scenarioId === 'cannae' ? 0.4 : this.scenarioId === 'hastings' ? 1.35 : 1.1;
      for (const f of this.formations) {
        if (!viable(f)) continue;
        this._sampleFormation(f);
        let target = this._nearest(f);
        if (!target) continue;
        const d = distance(f, target);
        const melee = d < this._meleeRange(f, target) && this._clearPath(f.x, f.y, target.x, target.y);
        const readiness = f._skill * (0.55 + f.morale / 180) * (0.55 + f.cohesion * 0.0045) * (1 - f.fatigue * 0.004);
        let amount = 0;
        if (melee) {
          f.combatTargetId = target.id;
          engaged[f.id] = 1;
          engaged[target.id] = 1;
          let power = readiness;
          if (f.type === 'archers') power *= 0.45;
          if (f.type === 'artillery') power *= 0.16;
          if (f.type === 'cavalry') {
            const square = target.stance === 'square' && target.cohesion > 35;
            power *= square ? 0.29 : 1.15 + f.momentum * 1.7;
            if (target.weapon === 'spear' && angleDistance(Math.atan2(f.y - target.y, f.x - target.x), target.angle) < 1.15) power *= 0.68;
            if (f.momentum > 0.3 && !square) {
              pressure[target.id] += dt * f.momentum * 0.85;
              disruption[target.id] += dt * f.momentum * 1.5;
            }
          }
          if (f.stance === 'column') power *= 0.78;
          if (f.stance === 'square') power *= 0.75;
          const incoming = Math.atan2(f.y - target.y, f.x - target.x);
          const flank = angleDistance(incoming, target.angle);
          if (flank > 1.6 && target.stance !== 'square') {
            const rear = flank > 2.45;
            power *= rear ? 1.65 : 1.3;
            pressure[target.id] += dt * (rear ? 0.23 : 0.12) * tempo;
            disruption[target.id] += dt * (rear ? 0.35 : 0.18);
          }
          power *= clamp(1 + (f.elevation - target.elevation) * 0.007, 0.65, 1.3);
          amount = f.count * power * 0.0062 * dt * tempo;
          if (f._impactClock <= 0) {
            this._emit('impact', f, target, 0.5);
            f._impactClock = 1.15;
          }
        } else if (f.range && f.ammo > 0 && f.reload <= 0 && f._moved < dt * 8) {
          // Pick an exposed target; nearby friendly ranks may block a shot at the closest enemy.
          let best = Infinity;
          target = null;
          for (const candidate of this.formations) {
            if (candidate.team === f.team || !viable(candidate) || !this._canFire(f, candidate)) continue;
            const range = distance(f, candidate);
            if (range < best) { best = range; target = candidate; }
          }
          if (target) {
            f.combatTargetId = target.id;
            const range = distance(f, target);
            const shotPower = {bow: 0.012, sling: 0.011, musket: 0.024, cannon: 0.14}[f.weapon] || 0;
            const accuracy = clamp(1.15 - range / f.range * 0.65, 0.4, 1);
            const elevation = clamp(1 + (f.elevation - target.elevation) * 0.004, 0.72, 1.22);
            const square = target.stance === 'square' ? (f.weapon === 'cannon' ? 1.7 : 1.2) : 1;
            const frontage = f.stance === 'column' ? 0.55 : f.stance === 'square' ? 0.4 : 1;
            const cover = 1 - target.cover * (f.weapon === 'cannon' ? 0.6 : 0.9);
            amount = f.count * shotPower * readiness * accuracy * elevation * square * frontage * cover * tempo;
            pressure[target.id] += f.weapon === 'cannon' ? 2.2 : f.weapon === 'musket' ? 0.6 : 0.2;
            disruption[target.id] += f.weapon === 'cannon' ? 2 : 0.4;
            f.ammo--;
            f.reload = f.reloadDuration;
            f.fatigue = clamp(f.fatigue + 0.45, 0, 100);
            const type = f.weapon === 'cannon' ? 'cannon' : f.weapon === 'musket' ? 'musket' : 'arrow';
            this._emit(type, f, target, type === 'arrow' ? 0.85 : type === 'cannon' ? 1.1 : 0.6);
          }
        }
        if (amount > 0 && target) {
          if (f.status !== 'charging') f.status = 'attacking';
          damage[target.id] += amount;
          f._killFraction += amount;
          const credited = Math.floor(f._killFraction);
          f.kills += credited;
          f._killFraction -= credited;
        }
      }

      for (const f of this.formations) {
        if (!viable(f)) continue;
        const effectiveDamage = Math.min(f.count, damage[f.id]);
        f._lossFraction += effectiveDamage;
        const lost = Math.min(f.count, Math.floor(f._lossFraction));
        f.count -= lost;
        f._lossFraction -= lost;
        const moving = f._moved > dt * 3;
        if (effectiveDamage > 0) f._underFire = 5;
        const threatened = engaged[f.id] || f._underFire > 0;
        const resting = !moving && !threatened;
        const roughness = clamp(1 - this.terrain.sample(f.x, f.y).speed, 0, 1);
        f.fatigue = clamp(f.fatigue + dt * (moving ? (f.chargeTime > 0 ? 1.75 : 0.48) + roughness * 0.9 : engaged[f.id] ? 0.22 : -0.8), 0, 100);
        f.cohesion = clamp(f.cohesion - effectiveDamage / Math.max(1, f.initial) * 40 - disruption[f.id] +
          dt * (resting ? 0.7 : moving ? -(roughness * 0.55 + (f.chargeTime > 0 ? 0.19 : 0.04)) : -0.025), 0, 100);
        const casualtyShock = effectiveDamage / Math.max(1, f.initial) * 126;
        const moraleLoss = casualtyShock + pressure[f.id] + (engaged[f.id] ? dt * 0.026 * tempo : 0);
        f.morale = clamp(f.morale - moraleLoss + (resting ? dt * 0.24 : 0), 0, 100);
        if (f.count <= 0) {
          f.count = 0; f.morale = 0; f.status = 'defeated';
        } else if (f.morale <= 18 || f.count < f.initial * 0.23 || (f.cohesion < 14 && f.morale < 40)) {
          f.status = 'routing'; f.command = 'route'; f.targetId = null;
          f._path = []; f._pathClock = 0; f._plannedX = NaN;
          for (const ally of this.formations) {
            if (ally !== f && ally.team === f.team && viable(ally) && distance(ally, f) < 270) {
              ally.morale = Math.max(0, ally.morale - 7);
              ally.cohesion = Math.max(0, ally.cohesion - 5);
            }
          }
        }
      }
      this._checkWinner();
      if (!this.winner && this.time >= this.timeLimit) {
        const strength = [0, 0];
        for (const f of this.formations) if (viable(f)) strength[f.team] += f.count * (0.4 + f.morale / 250 + f.cohesion / 500);
        const difference = Math.abs(strength[0] - strength[1]);
        this.winner = difference < Math.max(strength[0], strength[1]) * 0.03 ? 'draw' : strength[0] > strength[1] ? 'friendly' : 'enemy';
        this.resultReason = 'time_limit';
      }
    }

    _checkWinner() {
      const active = [false, false];
      for (const f of this.formations) if (viable(f)) active[f.team] = true;
      if (!active[0] && !active[1]) this.winner = 'draw';
      else if (!active[0]) this.winner = 'enemy';
      else if (!active[1]) this.winner = 'friendly';
      if (this.winner) this.resultReason = 'army_routed';
    }

    getStats() {
      const counts = [0, 0];
      const morale = [0, 0];
      const active = [0, 0];
      const routed = [0, 0];
      const fatigue = [0, 0];
      const cohesion = [0, 0];
      for (const f of this.formations) {
        counts[f.team] += f.count;
        morale[f.team] += f.count * f.morale;
        fatigue[f.team] += f.count * f.fatigue;
        cohesion[f.team] += f.count * f.cohesion;
        if (viable(f)) active[f.team] += f.count;
        if (f.status === 'routing') routed[f.team] += f.count;
      }
      return {
        friendly: counts[0], enemy: counts[1],
        friendlyInitial: this.friendlyInitial, enemyInitial: this.enemyInitial,
        friendlyMorale: counts[0] ? morale[0] / counts[0] : 0,
        enemyMorale: counts[1] ? morale[1] / counts[1] : 0,
        friendlyFatigue: counts[0] ? fatigue[0] / counts[0] : 0,
        enemyFatigue: counts[1] ? fatigue[1] / counts[1] : 0,
        friendlyCohesion: counts[0] ? cohesion[0] / counts[0] : 0,
        enemyCohesion: counts[1] ? cohesion[1] / counts[1] : 0,
        friendlyActive: active[0], enemyActive: active[1],
        friendlyRouted: routed[0], enemyRouted: routed[1],
        time: this.time, winner: this.winner, timeLimit: this.timeLimit, resultReason: this.resultReason
      };
    }

    snapshot() {
      return {
        ...this.getStats(),
        formations: this.formations.map(f => Object.fromEntries(Object.entries(f).filter(([key]) => !key.startsWith('_')))),
        effects: this.effects.map(effect => ({...effect}))
      };
    }
  }

  global.BattleEngine = BattleEngine;
})(typeof window !== 'undefined' ? window : globalThis);
