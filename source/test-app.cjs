/* DOM integration: npm install --no-save jsdom; node test-app.cjs.
   Executes app + terrain + simulation with a mock renderer. This is not browser/graphics verification. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = __dirname;
const errors = [];
const checks = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', error => errors.push(error.message));
const dom = new JSDOM(fs.readFileSync(path.join(root, 'index.html'), 'utf8'), {
  url: 'https://field-command.test/', runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole
});
const { window } = dom;
const document = window.document;
window.addEventListener('error', event => errors.push(event.error?.stack || event.message));
window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
window.HTMLElement.prototype.setPointerCapture = function (id) { this._pointerCapture = id; };
window.HTMLElement.prototype.hasPointerCapture = function (id) { return this._pointerCapture === id; };
window.HTMLElement.prototype.releasePointerCapture = function () { this._pointerCapture = null; };
let raf = [], now = 0;
window.requestAnimationFrame = callback => { raf.push(callback); return raf.length; };
window.cancelAnimationFrame = () => {};
const map = document.getElementById('map-container');
let bounds = { left: 274, top: 124, width: 1040, height: 580 };
map.getBoundingClientRect = () => ({ ...bounds, x: bounds.left, y: bounds.top,
  right: bounds.left + bounds.width, bottom: bounds.top + bounds.height, toJSON() { return this; } });

// The real app and simulation execute unchanged; only canvas rendering/layout is substituted.
window.BattleRenderer = class MockRenderer {
  constructor(container) {
    this.container = container; this.view = { cx: 900, cy: 600, zoom: 1 };
    this.stats = { renderer: 'Canvas', drawnSoldiers: 0 }; this.frames = []; this.resize();
  }
  resize() { this.width = bounds.width; this.height = bounds.height; this.fitScale = Math.min(this.width / 1800, this.height / 1200); }
  get scale() { return this.fitScale * this.view.zoom; }
  setScenario(scenario) { this.scenario = scenario; }
  setFormations(formations) { this.formations = formations; }
  resetView() { this.view = { cx: 900, cy: 600, zoom: 1 }; }
  worldToScreen(x, y) { return { x: (x - this.view.cx) * this.scale + this.width / 2, y: (y - this.view.cy) * this.scale + this.height / 2 }; }
  screenToWorld(x, y) { return { x: (x - bounds.left - this.width / 2) / this.scale + this.view.cx, y: (y - bounds.top - this.height / 2) / this.scale + this.view.cy }; }
  pan(dx, dy) { this.view.cx -= dx / this.scale; this.view.cy -= dy / this.scale; }
  zoomAt(x, y, factor) { const before = this.screenToWorld(x, y); this.view.zoom = Math.max(.65, Math.min(5, this.view.zoom * factor)); const after = this.screenToWorld(x, y); this.view.cx += before.x - after.x; this.view.cy += before.y - after.y; }
  render(formations, selected, opts) { this.last = { formations, selected, opts }; this.stats.drawnSoldiers = formations.reduce((n, f) => n + f.count, 0); }
};

const $ = id => { const node = document.getElementById(id); assert.ok(node, `DOM element #${id} exists`); return node; };
const click = id => $(id).click();
const set = (id, value, type = 'change') => { const node = $(id); node.value = value; node.dispatchEvent(new window.Event(type, { bubbles: true })); };
const key = (value, code = value) => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: value, code, bubbles: true, cancelable: true }));
function tick(seconds = .2) {
  for (let i = 0; i < Math.ceil(seconds * 60); i++) {
    const callbacks = raf; raf = []; now += 1000 / 60;
    for (const callback of callbacks) callback(now);
  }
  assert.deepEqual(errors, [], 'No application runtime errors');
}
function pointEvent(type, x, y, extra = {}) {
  const event = new window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  Object.defineProperty(event, 'pointerType', { value: extra.pointerType || 'mouse' });
  map.dispatchEvent(event);
}
function tapWorld(x, y, extra = {}) {
  const point = window.fieldCommand.renderer.worldToScreen(x, y);
  pointEvent('pointerdown', bounds.left + point.x, bounds.top + point.y, extra);
  pointEvent('pointerup', bounds.left + point.x, bounds.top + point.y, extra);
}
function scenario(index) { click('scenario-picker'); const choice = document.querySelectorAll('.scenario-option')[index]; assert.ok(choice); choice.click(); tick(.15); }
function check(name, callback) { callback(); checks.push(name); }

try {
  for (const script of document.querySelectorAll('script[src]')) {
    const source = script.getAttribute('src');
    if (source === 'renderer.js') continue;
    window.eval(fs.readFileSync(path.join(root, source), 'utf8') + `\n//# sourceURL=${source}`);
  }
  tick(.2);
  const api = () => window.fieldCommand;
  assert.ok(api(), 'App initialized');
  check('Initial DOM and engine load', () => {
    assert.equal(api().engine.scenarioId, 'cannae');
    assert.equal(api().engine.formations.length, 24);
    assert.equal(api().engine.formations.reduce((n, f) => n + f.count, 0), 10000);
    assert.equal(document.querySelectorAll('.unit-card').length, 12);
    assert.equal($('battle-name').textContent, 'Cannae');
  });
  check('100,000-soldier engine and roster reset', () => {
    set('army-size', '100000'); tick(.2);
    assert.equal(api().engine.formations.reduce((n, f) => n + f.count, 0), 100000);
    assert.equal(api().recordingLength, 1); assert.equal(api().running, false);
  });
  check('Selection, hold, charge, and formation controls', () => {
    document.querySelector('.unit-card').click();
    assert.equal(api().selected.join(','), '0');
    assert.equal($('condition-panel').hidden, false);
    const unit = api().engine.formations[0];
    const restore = { morale: unit.morale, cohesion: unit.cohesion, fatigue: unit.fatigue };
    unit.morale = 73; unit.cohesion = 61; unit.fatigue = 68; tick(.2);
    assert.equal($('condition-morale').textContent, '73%');
    assert.equal($('condition-cohesion').textContent, '61%');
    assert.equal($('condition-fatigue').textContent, '68%');
    assert.match($('condition-advice').textContent, /Tired/);
    Object.assign(unit, restore); tick(.2);
    click('inspect-selection'); assert.equal(api().renderer.view.cx, unit.x); assert.ok(api().renderer.view.zoom >= 5);
    click('reset-view');
    click('charge-order'); assert.equal(api().engine.formations[0].command, 'charge');
    click('hold-order'); assert.equal(api().engine.formations[0].command, 'hold');
    const formation = $('formation-select');
    const option = [...formation.options].find(o => o.value === 'column');
    if (option) { set('formation-select', 'column'); assert.equal(api().engine.formations[0].stance, 'column'); }
    click('select-all'); assert.equal(api().selected.length, 12);
    key('Escape', 'Escape'); assert.equal(api().selected.length, 0); assert.equal($('condition-panel').hidden, true);
  });
  check('Map selection and paused move order', () => {
    const unit = api().engine.formations[0]; tapWorld(unit.x, unit.y);
    assert.equal(api().selected.join(','), '0');
    if (api().engine.terrain) {
      const previous = { command: unit.command, x: unit.targetX, y: unit.targetY };
      assert.equal(api().engine.terrain.sample(190, 180).blocked, true);
      tapWorld(190, 180);
      assert.equal(unit.command, previous.command); assert.equal(unit.targetX, previous.x); assert.equal(unit.targetY, previous.y);
      assert.match($('toast').textContent, /Deep water/);
    }
    tapWorld(300, 650); assert.equal(unit.command, 'move');
    assert.equal(api().running, false);
  });
  check('Simulation advances, pauses, and records', () => {
    const unit = api().engine.formations[0], previousY = unit.y;
    click('play-button'); tick(3.2); assert.ok(api().engine.time > 3);
    assert.notEqual(unit.y, previousY); assert.ok(api().recordingLength >= 3);
    if (!process.argv.includes('--initial')) {
      assert.ok(unit.fatigue > 0, 'Actual movement increases fatigue');
      assert.equal($('condition-fatigue').textContent, Math.round(unit.fatigue) + '%');
      assert.equal($('condition-terrain').textContent, unit.terrain);
    }
    click('play-button'); const time = api().engine.time; tick(.25); assert.equal(api().engine.time, time);
  });
  check('Replay forward, scrub, restart, and paused return', () => {
    const time = api().engine.time;
    click('replay-button'); assert.equal(api().replayMode, true); tick(.6); assert.ok(api().replayCursor > 1);
    assert.ok(Math.abs(api().renderer.last.opts.time - .6) < .06, 'Replay advances by recorded seconds rather than one index per second');
    assert.equal($('replay-tray').hidden, false); assert.equal($('charge-order').disabled, true);
    set('replay-scrub', $('replay-scrub').max, 'input'); assert.equal(api().replayCursor, api().recordingLength - 1);
    click('play-button'); tick(.2); assert.ok(api().replayCursor < api().recordingLength - 1);
    click('replay-play'); const cursor = api().replayCursor; tick(.2); assert.equal(api().replayCursor, cursor);
    set('replay-scrub', 0, 'input'); tick(.1); assert.equal(api().replayCursor, 0);
    click('exit-replay'); assert.equal(api().replayMode, false); assert.equal(api().engine.time, time);
    assert.equal(api().running, false); assert.equal($('replay-tray').hidden, true);
  });
  check('Replay return preserves a running battle', () => {
    click('play-button'); tick(.2); click('replay-button'); tick(.2); click('exit-replay');
    assert.equal(api().running, true); const time = api().engine.time; tick(.2); assert.ok(api().engine.time > time);
    click('play-button');
  });
  check('Scenario switch, period roster, notes, and recording reset', () => {
    scenario(1); assert.equal(api().engine.scenarioId, 'hastings'); assert.equal(api().recordingLength, 1);
    assert.equal(api().running, false); assert.equal(api().selected.length, 0);
    scenario(2); assert.equal(api().engine.scenarioId, 'austerlitz');
    if (!process.argv.includes('--initial')) {
      assert.ok(api().engine.formations.some(f => /artillery|cannon|battery/.test(f.type + ' ' + f.name.toLowerCase())));
      assert.ok(!api().engine.formations.some(f => f.type === 'archers'));
      const ranged = api().engine.formations.find(f => f.team === 0 && f.maxAmmo > 0);
      assert.ok(ranged, 'Period weapon has ammunition');
      document.querySelector(`.unit-card[data-id="${ranged.id}"]`).click(); tick(.2);
      assert.match($('condition-ammo').textContent, /volleys/);
      const restore = { ammo: ranged.ammo, reload: ranged.reload };
      ranged.ammo = 2; ranged.reload = 3.4; tick(.2);
      assert.equal($('condition-ammo').textContent, '2 volleys left');
      assert.equal($('condition-reload').textContent, 'Reloading · 3.4s');
      ranged.ammo = 0; ranged.reload = 0; tick(.2);
      assert.equal($('condition-reload').textContent, 'Out of ammunition');
      Object.assign(ranged, restore); tick(.2);
      assert.ok(!/NaN|undefined/.test($('condition-panel').textContent));
      assert.ok(api().engine.terrain, 'Engine has shared terrain');
    }
    click('history-button'); assert.ok($('notes-context').textContent.trim());
    document.querySelector('#history-dialog .dialog-close').click();
  });
  check('Small-screen flag pointer coordinates', () => {
    scenario(0); set('army-size', '10000'); bounds = { left: 0, top: 110, width: 390, height: 250 };
    api().renderer.resize(); const f = api().engine.formations[2], ren = api().renderer;
    const p = ren.worldToScreen(f.x, f.y), a = f.angle + Math.PI / 2;
    const y = bounds.top + p.y - Math.max(14, (Math.abs(Math.sin(a)) * f.width + Math.abs(Math.cos(a)) * f.depth) * ren.scale / 2 + 7);
    pointEvent('pointerdown', bounds.left + p.x, y); pointEvent('pointerup', bounds.left + p.x, y);
    assert.equal(api().selected.join(','), '2');
  });
  check('Zoom, pan, keyboard selection, and reset', () => {
    const ren = api().renderer, zoom = ren.view.zoom; click('zoom-in'); assert.ok(ren.view.zoom > zoom);
    const x = ren.view.cx; key('ArrowRight', 'ArrowRight'); assert.ok(ren.view.cx > x);
    click('reset-view'); assert.equal(ren.view.zoom, 1); assert.equal(ren.view.cx, 900);
    key('a', 'KeyA'); assert.equal(api().selected.length, 12); key('h', 'KeyH');
    assert.ok(api().engine.formations.filter(f => f.team === 0).every(f => f.command === 'hold'));
  });
  console.log(JSON.stringify({ passed: true, method: 'JSDOM DOM/app/engine integration with a mocked renderer and controlled animation clock; not browser or graphics verification', checks, errors }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ passed: false, completedChecks: checks, message: error.message, stack: error.stack, errors }, null, 2));
  process.exitCode = 1;
} finally { dom.window.close(); }
