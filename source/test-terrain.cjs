const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'terrain.js'), 'utf8'), context);
const Terrain = context.window.FieldTerrain;

function checkPath(terrain, sx, sy, path) {
  let a = { x: sx, y: sy };
  for (const b of path) {
    assert(Number.isFinite(b.x) && Number.isFinite(b.y));
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      assert.equal(terrain.sample(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t).blocked,
        false, `Route crosses blocked ground between ${JSON.stringify(a)} and ${JSON.stringify(b)}`);
    }
    a = b;
  }
}

const cannae = new Terrain('cannae');
assert.equal(cannae.sample(190, 180).type, 'water');
assert.equal(cannae.sample(180, 560).type, 'ford');
assert(cannae.sample(180, 560).speed < 1);
const riverRoute = cannae.findPath(50, 200, 450, 200);
assert(riverRoute.length > 1, 'Cross-river order must detour through the ford');
assert(riverRoute.some(p => p.y > 480 && p.y < 650));
checkPath(cannae, 50, 200, riverRoute);
const snap = cannae.findPath(600, 180, 190, 180);
assert(snap.length > 0);
checkPath(cannae, 600, 180, snap);
assert(!cannae.sample(snap.at(-1).x, snap.at(-1).y).blocked);
assert.equal(cannae.findPath(NaN, 100, 400, 200).length, 0);
assert.equal(cannae.findPath(190, 180, 400, 200).length, 0);

// Close the only crossing and rebuild the navigation graph: banks disconnect.
const closedRiver = new Terrain('cannae');
closedRiver.fords = [];
closedRiver._nodes = [];
closedRiver._buildNavigation();
assert.equal(closedRiver.findPath(50, 200, 450, 200).length, 0);
assert.equal(cannae._traversable(220, 540, 140, 460), false, 'A grazing ford edge must not cut water');

const hastings = new Terrain('hastings');
assert(hastings.sample(900, 430).elevation > 60);
assert.equal(hastings.lineOfSight(900, 100, 900, 760), false, 'Ridge blocks fire from low ground');
assert.equal(hastings.lineOfSight(900, 430, 900, 760), true, 'Crest can see its southern slope');
assert.equal(hastings.lineOfSight(20, 180, 300, 180), false, 'Deep forest blocks sight');
assert(hastings.sample(140, 180).cover > 0);
assert(hastings.sample(820, 700).speed < 1);

const austerlitz = new Terrain('austerlitz');
assert.equal(austerlitz.sample(1450, 1020).blocked, true);
const pondRoute = austerlitz.findPath(1100, 1020, 1760, 1020);
assert(pondRoute.length > 1);
checkPath(austerlitz, 1100, 1020, pondRoute);
assert.equal(austerlitz.lineOfSight(400, 530, 1450, 530), false);

let seed = 42, checked = 0;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
for (const terrain of [cannae, austerlitz]) {
  for (let i = 0; i < 250; i++) {
    const sx = random() * 1800, sy = random() * 1200, tx = random() * 1800, ty = random() * 1200;
    if (terrain.sample(sx, sy).blocked) continue;
    const route = terrain.findPath(sx, sy, tx, ty);
    assert(route.length > 0, 'Every unblocked point in the scenario should be connected');
    checkPath(terrain, sx, sy, route);
    checked++;
  }
}
console.log(`Terrain tests passed: ford detours, unreachable bank, pond avoidance, ridge/forest sight, ${checked} sampled routes.`);
