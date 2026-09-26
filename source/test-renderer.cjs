/* Native Canvas and WebGL call-contract checks. Requires @napi-rs/canvas.
   These checks do not claim to execute a GPU shader. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createCanvas} = require('@napi-rs/canvas');

let fakeGL = null;
function canvasElement() {
  const canvas = createCanvas(1, 1);
  const getContext = canvas.getContext.bind(canvas);
  canvas.getContext = type => type === 'webgl' ? fakeGL : getContext('2d');
  canvas.style = {};
  canvas.setAttribute = canvas.replaceWith = canvas.addEventListener = canvas.remove = () => {};
  return canvas;
}
global.window = global;
global.devicePixelRatio = 1;
global.getComputedStyle = () => ({position: 'relative'});
global.document = {createElement: canvasElement};
for (const file of ['terrain.js', 'engine.js', 'renderer.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), {filename: file});
}
const container = {style: {}, appendChild() {},
  getBoundingClientRect: () => ({width: 1000, height: 650, left: 70, top: 90})};

const engine = new BattleEngine({id: 'austerlitz'}, 100000);
const renderer = new BattleRenderer(container);
renderer.setScenario({id: 'austerlitz'}, engine.terrain);
assert.equal(renderer.terrain, engine.terrain);
assert.equal(renderer.terrain.waters[0].x, 1450);
renderer.setFormations(engine.formations);
renderer.render(engine.formations, new Set([2]), {time: 0});
assert.equal(renderer.stats.drawnSoldiers, 100000);
const artillery = engine.formations.find(f => f.type === 'artillery');
assert(artillery, 'Austerlitz has an artillery battery');
assert.equal(renderer.soldierKind(artillery), 5, 'Soldier points represent gun crew, not one cannon each');
assert.equal(renderer.soldierKind(engine.formations[2]), 3, 'Musket identity comes from weapon, not generic infantry type');
const screen = renderer.worldToScreen(950, 530);
const world = renderer.screenToWorld(screen.x + 70, screen.y + 90);
assert(Math.hypot(world.x - 950, world.y - 530) < 1e-8);
const anchor = renderer.screenToWorld(570, 390);
renderer.zoomAt(570, 390, 100);
assert.equal(renderer.view.zoom, 12);
const after = renderer.screenToWorld(570, 390);
assert(Math.hypot(after.x-anchor.x, after.y-anchor.y) < 1e-8);
renderer.view.cx = engine.formations[2].x;
renderer.view.cy = engine.formations[2].y;
const effects = ['arrow', 'musket', 'cannon', 'impact'].map((type, id) => ({
  id, type, x: renderer.view.cx, y: renderer.view.cy, tx: renderer.view.cx + 80,
  ty: renderer.view.cy - 100, time: 0, life: 1
}));
engine.formations[2].count -= 7;
renderer.render(engine.formations, new Set([2]), {time: .3, effects, selectionRect: {x: 200,y: 200,w: -100,h: -80}});
assert.equal(renderer.stats.drawnSoldiers, 99993);
assert(renderer.scarCanvas.getContext('2d').getImageData(0,0,1800,1200).data.some((n,i) => i % 4 === 3 && n > 0));
renderer.render(engine.formations, new Set(), {time: .1});
assert(!renderer.scarCanvas.getContext('2d').getImageData(0,0,1800,1200).data.some((n,i) => i % 4 === 3 && n > 0), 'Seeking backward clears future casualty marks');
renderer.destroy();

let vertices;
const draws = [];
const shaders = [];
fakeGL = new Proxy({
  ARRAY_BUFFER: 34962, STATIC_DRAW: 35044, POINTS: 0,
  VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632,
  createShader: () => ({}), shaderSource: (_, source) => shaders.push(source),
  getShaderParameter: () => true, createProgram: () => ({}), getProgramParameter: () => true,
  createBuffer: () => ({}), getUniformLocation: (_, name) => name, getAttribLocation: () => 0,
  bufferData: (_, data) => { vertices = data; },
  drawArrays: (_, start, count) => draws.push({start, count})
}, {get: (object, key) => key in object ? object[key] : () => {}});
const gpu = new BattleRenderer(container);
gpu.setScenario({id: 'austerlitz'}, engine.terrain);
gpu.setFormations(engine.formations);
gpu.render(engine.formations, new Set(), {time: .3, effects});
assert.equal(vertices.length, 200000);
assert(vertices.every(Number.isFinite));
assert.equal(draws.length, 24);
assert.equal(draws.reduce((sum, draw) => sum + draw.count, 0), 99993);
assert(shaders.every(source => source.includes('uniform mediump vec2 u_rotation;')));
assert(shaders.every(source => source.includes('varying mediump float v_shade;')));
gpu.destroy();
console.log('PASS renderer: shared terrain, 100k buffers and survivor counts, troop identities, detail zoom, coordinate transforms, effects, casualty marks and replay reset, matching shader precision.');
