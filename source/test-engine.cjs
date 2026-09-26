'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {window: {}};
vm.createContext(context);
for (const file of ['terrain.js', 'engine.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), context);
const BattleEngine = context.window.BattleEngine;
const STEP = 1 / 30;
const ids = Array.from({length: 12}, (_, i) => i);

function advance(engine, seconds) {
  for (let i = 0; i < Math.ceil(seconds / STEP); i++) engine.update(STEP);
}

function flatTerrain(sample = () => ({})) {
  return {
    sample(x, y) { return {type: 'plain', name: 'Open ground', blocked: false, speed: 1, cover: 0, elevation: 0, ...sample(x, y)}; },
    findPath(sx, sy, tx, ty) { return [{x: tx, y: ty}]; },
    lineOfSight() { return true; }
  };
}

// Two isolated formations let the tests distinguish a mechanic from unrelated AI changes.
function pair(friendlyId = 1, enemyId = 13, terrain = flatTerrain()) {
  const engine = new BattleEngine({id: 'austerlitz', seed: 42}, 100000);
  engine._ai = () => {};
  engine.terrain = terrain;
  engine.formations.forEach(f => { f.count = 0; f.status = 'defeated'; });
  const friendly = engine.formations[friendlyId], enemy = engine.formations[enemyId];
  for (const f of [friendly, enemy]) {
    Object.assign(f, {count: 1000, initial: 1000, morale: 100, cohesion: 100, fatigue: 0, status: 'holding', command: 'hold', targetId: null});
  }
  Object.assign(friendly, {x: 700, y: 800, angle: -Math.PI / 2});
  Object.assign(enemy, {x: 700, y: 570, angle: Math.PI / 2, ammo: 0});
  return {engine, friendly, enemy};
}

function validate(engine) {
  for (const f of engine.formations) {
    for (const key of ['x', 'y', 'angle', 'count', 'morale', 'width', 'depth', 'fatigue', 'cohesion', 'ammo', 'reload', 'range']) {
      assert.ok(Number.isFinite(f[key]), `${f.name}.${key} must be finite`);
    }
    assert.ok(Number.isInteger(f.count) && f.count >= 0 && f.count <= f.initial);
    for (const key of ['morale', 'fatigue', 'cohesion']) assert.ok(f[key] >= 0 && f[key] <= 100);
    assert.ok(Number.isInteger(f.ammo) && f.ammo >= 0 && f.ammo <= f.maxAmmo);
    assert.ok(!engine.terrain.sample(f.x, f.y).blocked, `${f.name} must stay on passable ground`);
  }
  const stats = engine.getStats();
  assert.equal(stats.friendly + stats.enemy, engine.formations.reduce((sum, f) => sum + f.count, 0));
}

for (const total of [0, 1, 23, 1001, 10000, 99999, 100000]) {
  const engine = new BattleEngine({id: 'cannae', ratio: 0.4}, total);
  assert.equal(engine.formations.length, 24);
  assert.equal(engine.formations.reduce((sum, f) => sum + f.initial, 0), total);
  assert.equal(engine.getStats().friendlyInitial, Math.round(total * 0.4));
  assert.equal(new Set(engine.formations.map(f => f.id)).size, 24);
  validate(engine);
}

const roster = new BattleEngine({id: 'austerlitz'}, 100000);
assert.equal(roster.formations.filter(f => f.type === 'artillery').length, 2);
assert.equal(roster.formations.filter(f => f.type === 'archers').length, 0);
assert.ok(roster.formations.filter(f => f.type === 'infantry').every(f => f.weapon === 'musket'));
assert.ok(roster.formations.find(f => f.type === 'artillery').count < roster.formations[1].count);
roster.setFormation([0, 1, 10], 'square');
assert.equal(roster.formations[1].stance, 'square');
assert.equal(roster.formations[1].width, roster.formations[1].depth);
assert.equal(roster.formations[0].stance, 'line', 'cavalry cannot form an infantry square');
assert.equal(roster.formations[10].stance, 'line', 'artillery cannot form an infantry square');
roster.setFormation([1], 'column');
assert.ok(roster.formations[1].depth > roster.formations[1].width);

const march = pair();
Object.assign(march.friendly, {x: 400, y: 1000, ammo: 0});
Object.assign(march.enemy, {x: 1700, y: 100});
march.engine.order([1], 1250, 1000);
advance(march.engine, 15);
assert.ok(march.friendly.x > 600, 'an order moves the formation');
assert.ok(march.friendly.fatigue > 5, 'marching causes fatigue');
const tired = march.friendly.fatigue, loose = march.friendly.cohesion;
march.engine.hold([1]);
const held = {x: march.friendly.x, y: march.friendly.y};
advance(march.engine, 12);
assert.equal(march.friendly.x, held.x);
assert.equal(march.friendly.y, held.y);
assert.ok(march.friendly.fatigue < tired, 'rest recovers fatigue');
assert.ok(march.friendly.cohesion > loose, 'rest restores cohesion');

const fresh = pair(), exhausted = pair();
for (const fixture of [fresh, exhausted]) {
  Object.assign(fixture.friendly, {x: 400, y: 1000, ammo: 0});
  Object.assign(fixture.enemy, {x: 1700, y: 100});
  fixture.engine.order([1], 1400, 1000);
}
exhausted.friendly.fatigue = 90;
advance(fresh.engine, 8); advance(exhausted.engine, 8);
assert.ok(fresh.friendly.x - 400 > (exhausted.friendly.x - 400) * 1.4, 'fatigue has a real movement penalty');

const volley = pair();
volley.engine.update(STEP);
assert.equal(volley.friendly.ammo, volley.friendly.maxAmmo - 1, 'a volley consumes one ammunition load');
assert.ok(volley.enemy.count < 1000, 'a volley causes casualties');
assert.ok(volley.engine.effects.some(effect => effect.type === 'musket'));
const ammoAfterShot = volley.friendly.ammo;
advance(volley.engine, 2);
assert.equal(volley.friendly.ammo, ammoAfterShot, 'reload prevents another immediate volley');
advance(volley.engine, 7);
assert.equal(volley.friendly.ammo, ammoAfterShot - 1, 'a loaded weapon can fire again');
volley.friendly.ammo = 0;
const survivors = volley.enemy.count;
advance(volley.engine, 12);
assert.equal(volley.enemy.count, survivors, 'empty ammunition stops ranged casualties');

const wrongFacing = pair();
wrongFacing.friendly.angle = Math.PI / 2;
advance(wrongFacing.engine, 2);
assert.equal(wrongFacing.friendly.ammo, wrongFacing.friendly.maxAmmo, 'a formation cannot fire behind itself');
const obstructed = pair();
const ally = obstructed.engine.formations[2];
Object.assign(ally, {x: 700, y: 680, count: 1000, initial: 1000, status: 'holding', command: 'hold', weapon: 'sword', range: 0, ammo: 0});
obstructed.engine.update(STEP);
assert.equal(obstructed.friendly.ammo, obstructed.friendly.maxAmmo, 'friendly ranks obstruct musket fire');
const hidden = pair();
hidden.engine.terrain.lineOfSight = () => false;
advance(hidden.engine, 1);
assert.equal(hidden.friendly.ammo, hidden.friendly.maxAmmo, 'terrain blocks ranged fire');

const exposed = pair();
const covered = pair(1, 13, flatTerrain((x, y) => y < 700 ? {cover: 0.4, type: 'forest', name: 'Woodland', speed: 0.58} : {}));
exposed.engine.update(STEP); covered.engine.update(STEP);
assert.ok(1000 - covered.enemy.count < 1000 - exposed.enemy.count, 'woodland cover reduces ranged casualties');
const downhill = pair(1, 13, flatTerrain((x, y) => ({elevation: y > 700 ? 65 : 0})));
const uphill = pair(1, 13, flatTerrain((x, y) => ({elevation: y < 700 ? 65 : 0})));
downhill.engine.update(STEP); uphill.engine.update(STEP);
assert.ok(downhill.enemy.count < uphill.enemy.count, 'firing from higher ground improves effectiveness');

const openMarch = pair(), forestMarch = pair(1, 13, flatTerrain(() => ({speed: 0.58, cover: 0.4, type: 'forest', name: 'Woodland'})));
for (const fixture of [openMarch, forestMarch]) {
  Object.assign(fixture.friendly, {x: 400, y: 1000, ammo: 0});
  Object.assign(fixture.enemy, {x: 1700, y: 100});
  fixture.engine.order([1], 1400, 1000);
  advance(fixture.engine, 8);
}
assert.ok(openMarch.friendly.x > forestMarch.friendly.x + 50, 'woodland slows movement');
assert.ok(forestMarch.friendly.fatigue > openMarch.friendly.fatigue, 'rough movement costs more fatigue');

function cavalryAttack(square) {
  const fixture = pair(1, 12);
  Object.assign(fixture.friendly, {x: 700, y: 700, ammo: 0, stance: square ? 'square' : 'line'});
  Object.assign(fixture.enemy, {x: 700, y: 610, momentum: 1});
  advance(fixture.engine, 10);
  return fixture.friendly.count;
}
assert.ok(cavalryAttack(true) > cavalryAttack(false), 'a cohesive square reduces cavalry casualties');

const river = new BattleEngine({id: 'cannae', ratio: 0.4}, 100000);
river._ai = () => {};
river.formations.forEach(f => {f.command = 'hold';});
const crossing = river.formations[0];
Object.assign(crossing, {x: 80, y: 850, targetX: 80, targetY: 850});
river.order([0], 330, 850);
let usedFord = false;
for (let i = 0; i < 3600 && Math.hypot(crossing.x - 330, crossing.y - 850) > 6; i++) {
  const before = {x: crossing.x, y: crossing.y};
  river.update(STEP);
  assert.ok(!river.terrain.sample(crossing.x, crossing.y).blocked, 'moving formation never enters the river');
  assert.ok(river.terrain.canTraverse(before.x, before.y, crossing.x, crossing.y), 'each movement segment avoids blocked water');
  usedFord ||= river.terrain.sample(crossing.x, crossing.y).type === 'ford';
}
assert.ok(usedFord, 'crossing the river uses its ford');
assert.ok(Math.hypot(crossing.x - 330, crossing.y - 850) < 8, 'the routed order reaches the far bank');

const first = new BattleEngine({id: 'hastings', seed: 42}, 100000);
const second = new BattleEngine({id: 'hastings', seed: 42}, 100000);
first.charge(ids); second.charge(ids);
advance(first, 25); advance(second, 25);
assert.equal(JSON.stringify(first.snapshot()), JSON.stringify(second.snapshot()), 'same seed and commands reproduce the same battle');
const saved = first.snapshot(), savedX = saved.formations[0].x;
first.formations[0].x++;
assert.equal(saved.formations[0].x, savedX, 'snapshots do not share formation objects');
assert.ok(saved.formations.every(f => Object.keys(f).every(key => !key.startsWith('_'))), 'recordings omit internal paths and counters');
if (first.effects.length) {
  const snapshotEffect = first.snapshot();
  const original = snapshotEffect.effects[0].x;
  first.effects[0].x++;
  assert.equal(snapshotEffect.effects[0].x, original, 'recorded effects are cloned');
}

for (const [id, ratio] of [['cannae', 0.4], ['hastings', 0.5], ['austerlitz', 0.48]]) {
  const battle = new BattleEngine({id, ratio}, 100000);
  battle.charge(ids);
  for (let step = 0; step < 18010 && !battle.winner; step++) {
    battle.update(STEP);
    if (step % 120 === 0) validate(battle);
  }
  validate(battle);
  assert.ok(['friendly', 'enemy', 'draw'].includes(battle.winner), `${id} reaches a result`);
  assert.ok(battle.time > 150 && battle.time < 480, `${id} resolves within eight minutes with active armies`);
  assert.equal(battle.resultReason, 'army_routed', 'active armies resolve before the time limit');
  const end = JSON.stringify(battle.snapshot());
  advance(battle, 10);
  assert.equal(JSON.stringify(battle.snapshot()), end, 'finished battles freeze');
  console.log(`${id}: ${battle.winner} after ${battle.time.toFixed(1)} seconds`);
}

console.log('Engine checks passed: exact 100k counts, period weapons, fatigue/rest, volleys/ammo/reload, facing, friendly obstruction, terrain sight, cover/elevation, squares, ford paths, determinism, snapshots, and complete battles.');
