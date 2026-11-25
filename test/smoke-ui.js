'use strict';

// Smoke test for js/editor.js using a minimal DOM stub. It loads the real
// editor script and drives its event handlers with synthetic mouse events.

const path = require('path');

function makeCtx() {
  return new Proxy({}, {
    get(t, p) { return p in t ? t[p] : function () {}; },
    set(t, p, v) { t[p] = v; return true; },
  });
}

function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    children: [],
    listeners: {},
    style: {},
    dataset: {},
    value: '',
    textContent: '',
    innerHTML: '',
    rows: 0,
    readOnly: false,
    placeholder: '',
    className: '',
    clientWidth: 800,
    clientHeight: 600,
    width: 0,
    height: 0,
    classList: {
      add() {}, remove() {}, toggle() {},
    },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: this.width, height: this.height }; },
    getContext() { return makeCtx(); },
    querySelectorAll() { return []; },
    click() {},
    focus() {},
  };
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) { html = v; if (v === '') el.children = []; },
  });
  return el;
}

const elements = {};
function el(id) {
  if (!elements[id]) elements[id] = makeEl(id === 'canvas' ? 'canvas' : 'div');
  return elements[id];
}

const store = {};

globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.devicePixelRatio = 1;
globalThis.document = {
  getElementById: el,
  createElement: (tag) => makeEl(tag),
  querySelectorAll: () => [],
  activeElement: null,
};
globalThis.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};
Object.defineProperty(globalThis, 'navigator', {
  value: { clipboard: { writeText: () => Promise.resolve() } },
  configurable: true,
});
globalThis.prompt = () => null;
globalThis.confirm = () => true;
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};

const winListeners = {};
const origAdd = globalThis.addEventListener;
globalThis.addEventListener = (ev, fn) => { (winListeners[ev] = winListeners[ev] || []).push(fn); };

globalThis.LGECircuit = require(path.join(__dirname, '..', 'js', 'core', 'circuit.js'));
globalThis.LGENetlist = require(path.join(__dirname, '..', 'js', 'core', 'netlist.js'));
globalThis.LGEVHDL = require(path.join(__dirname, '..', 'js', 'core', 'vhdl.js'));
globalThis.LGEExamples = require(path.join(__dirname, '..', 'js', 'core', 'examples.js'));
require(path.join(__dirname, '..', 'js', 'editor.js'));

const lge = globalThis.__lge;

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed++; } else { failed++; console.error('FAIL: ' + name); }
}
function eq(a, b, name) { ok(a === b, name + ' (expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a) + ')'); }

ok(lge && lge.state, 'editor booted and exposed __lge');
eq(lge.state.circuit.components.length > 0, true, 'default circuit loaded (example)');

// exports through the same actions the toolbar buttons use
const txt = lge.actionExportText();
ok(txt.text.indexOf('logicgate-netlist v1') === 0, 'export text produces netlist header');
eq(txt.filename.endsWith('.txt'), true, 'export text filename');
const vhdlFiles = lge.actionExportVHDL();
eq(vhdlFiles.length, 2, 'export VHDL produces DUT + testbench');
ok(vhdlFiles[0].filename.endsWith('.vhd') && vhdlFiles[1].filename.endsWith('_tb.vhd'), 'VHDL filenames');
ok(/entity \w+ is/.test(vhdlFiles[0].text), 'VHDL DUT has entity');

// import round-trips through the same action the Import dialog uses
const back = lge.actionImport(txt.text, 'auto');
eq(back.components.length, lge.state.circuit.components.length, 'import netlist: same component count');
const backV = lge.actionImport(vhdlFiles[0].text, 'vhdl');
ok(backV.components.length > 0, 'import VHDL: components created');
let threw = false;
try { lge.actionImport('this is not a circuit', 'auto'); } catch (e) { threw = true; }
ok(threw, 'import of garbage throws (dialog shows the error)');

// drive the canvas with synthetic events
function fire(target, ev, obj) {
  const fns = target === globalThis ? (winListeners[ev] || []) : (target.listeners[ev] || []);
  for (const fn of fns) fn(Object.assign({ preventDefault() {}, clientX: 0, clientY: 0 }, obj));
}
const canvas = el('canvas');

lge.loadCircuit(lge.Examples.build('empty'));
eq(lge.state.circuit.components.length, 0, 'empty example loads');

// place a switch via palette tool + click
lge.state.tool = 'input';
fire(canvas, 'mousedown', { clientX: 100, clientY: 100 });
fire(canvas, 'mouseup', { clientX: 100, clientY: 100 });
eq(lge.state.circuit.components.length, 1, 'click with tool places a component');
const sw = lge.state.circuit.components[0];
eq(sw.type, 'input', 'placed component is the switch');

// place an AND gate
lge.state.tool = 'and';
fire(canvas, 'mousedown', { clientX: 300, clientY: 100 });
fire(canvas, 'mouseup', { clientX: 300, clientY: 100 });
eq(lge.state.circuit.components.length, 2, 'second component placed');
const gate = lge.state.circuit.components[1];

// wire switch output pin -> gate input a pin
fire(canvas, 'mousedown', { clientX: sw.x + 84, clientY: sw.y + 23 });
fire(canvas, 'mouseup', { clientX: gate.x, clientY: gate.y + 52 * 0.32 });
eq(lge.state.circuit.wires.length, 1, 'pin-to-pin drag creates a wire');
eq(lge.state.circuit.wires[0].from, sw.id + '.q', 'wire starts at switch output');
eq(lge.state.circuit.wires[0].to, gate.id + '.a', 'wire ends at gate input a');

// toggle the switch with a click (mousedown+mouseup without movement)
const before = sw.value;
fire(canvas, 'mousedown', { clientX: sw.x + 20, clientY: sw.y + 23 });
fire(canvas, 'mouseup', { clientX: sw.x + 20, clientY: sw.y + 23 });
eq(sw.value, 1 - before, 'clicking a switch toggles its value');

// gate output should follow: and(a=1, b=unconnected) -> null
let sim = lge.Circuit.simulate(lge.state.circuit);
eq(sim.values[gate.id].y, null, 'gate with unconnected input is null');

// wire switch to gate b as well -> and(1,1) = 1
fire(canvas, 'mousedown', { clientX: sw.x + 84, clientY: sw.y + 23 });
fire(canvas, 'mouseup', { clientX: gate.x, clientY: gate.y + 52 * 0.68 });
sim = lge.Circuit.simulate(lge.state.circuit);
eq(sim.values[gate.id].y, 1, 'and(1,1) = 1 after wiring second input');

// delete selected wire via Delete key
lge.state.selection = { kind: 'wire', id: lge.state.circuit.wires[1].id };
fire(globalThis, 'keydown', { key: 'Delete' });
eq(lge.state.circuit.wires.length, 1, 'Delete removes selected wire');

// delete selected component via Delete key
lge.state.selection = { kind: 'comp', id: gate.id };
fire(globalThis, 'keydown', { key: 'Delete' });
eq(lge.state.circuit.components.length, 1, 'Delete removes selected component');
eq(lge.state.circuit.wires.length, 0, 'removing a component removes its wires');

// persistence: refresh saved to localStorage
ok('lge-circuit-v1' in store, 'circuit autosaved to localStorage');
const saved = JSON.parse(store['lge-circuit-v1']);
eq(saved.components.length, 1, 'autosaved circuit has the remaining switch');

(async () => {
  // pulse button: fires on press, auto-resets even while held (no mouseup)
  lge.loadCircuit(lge.Examples.build('empty'));
  lge.state.tool = 'pulse';
  fire(canvas, 'mousedown', { clientX: 100, clientY: 100 });
  fire(canvas, 'mouseup', { clientX: 100, clientY: 100 });
  eq(lge.state.circuit.components.length, 1, 'pulse placed via palette tool');
  const p = lge.state.circuit.components[0];
  eq(p.type, 'pulse', 'placed component is a pulse button');
  fire(canvas, 'mousedown', { clientX: p.x + 20, clientY: p.y + 23 });
  eq(p.value, 1, 'pulse fires immediately on press');
  await new Promise(r => setTimeout(r, lge.PULSE_MS + 100));
  eq(p.value, 0, 'pulse auto-resets by itself even while the mouse is still held down');
  fire(canvas, 'mouseup', { clientX: p.x + 20, clientY: p.y + 23 });

  // loop in the UI: warning shown, simulation still produces a settled value
  lge.loadCircuit(lge.Examples.build('empty'));
  const r = lge.Circuit.addComponent(lge.state.circuit, 'input', { label: 'R', value: 0 });
  const s = lge.Circuit.addComponent(lge.state.circuit, 'input', { label: 'S', value: 1 });
  const n1 = lge.Circuit.addComponent(lge.state.circuit, 'nor', { label: 'Q' });
  const n2 = lge.Circuit.addComponent(lge.state.circuit, 'nor', { label: 'Qbar' });
  lge.Circuit.addWire(lge.state.circuit, r.id + '.q', n1.id + '.a');
  lge.Circuit.addWire(lge.state.circuit, n2.id + '.y', n1.id + '.b');
  lge.Circuit.addWire(lge.state.circuit, s.id + '.q', n2.id + '.a');
  lge.Circuit.addWire(lge.state.circuit, n1.id + '.y', n2.id + '.b');
  lge.refresh();
  eq(lge.state.sim.loops.settled.length, 2, 'UI simulates the feedback loop instead of blocking');
  eq(lge.state.sim.values[n1.id].y, 1, 'UI loop settles to a real value (S=1 -> Q=1)');
  const issues = lge.Circuit.validate(lge.state.circuit, lge.state.sim).issues;
  ok(issues.length > 0 && issues.every(i => i.level === 'warn'), 'UI loop issue is a warning, not an error');

  // speed control: max = immediate recalculation on every change
  lge.loadCircuit(lge.Examples.build('empty'));
  lge.state.rate = lge.RATE_MAX;
  const sw2 = lge.Circuit.addComponent(lge.state.circuit, 'input', { value: 0 });
  const o2 = lge.Circuit.addComponent(lge.state.circuit, 'output', {});
  lge.Circuit.addWire(lge.state.circuit, sw2.id + '.q', o2.id + '.a');
  lge.scheduleCalc();
  eq(lge.state.sim.values[o2.id].a, 0, 'max speed: calculation runs immediately');
  sw2.value = 1;
  lge.scheduleCalc();
  eq(lge.state.sim.values[o2.id].a, 1, 'max speed: every change recalculates at once (fastest the PC allows)');

  // throttled at 10 calc/s
  lge.state.rate = 10;
  sw2.value = 0;
  lge.scheduleCalc();
  eq(lge.state.sim.values[o2.id].a, 1, 'throttled (10/s): no recalculation before the next tick');
  await new Promise(r => setTimeout(r, 180));
  eq(lge.state.sim.values[o2.id].a, 0, 'throttled (10/s): tick recalculated within ~100 ms');

  // down to 1 full calculation per second
  lge.state.rate = 1;
  sw2.value = 1;
  lge.scheduleCalc();
  eq(lge.state.sim.values[o2.id].a, 0, '1 calc/s: change not applied before the tick');
  await new Promise(r => setTimeout(r, 1400));
  eq(lge.state.sim.values[o2.id].a, 1, '1 calc/s: one full recalculation per second applied the change');

  // tick-order sheet: opens from the speed slider and lists the calculation order
  const body = el('modalBody');
  lge.showTickSheet();
  ok(/tick/i.test(el('modalTitle').textContent), 'tick sheet opens with a tick title');
  const ol = body.children.find(c => c.tagName === 'OL');
  ok(!!ol, 'tick sheet contains the ordered step list');
  eq(ol.children.length, lge.Circuit.TICK_ORDER.length, 'tick sheet lists every documented tick step');
  ok(/fixed point/i.test(ol.children[3].textContent), 'step 4 documents loop fixed-point relaxation');
  ok(body.children.some(c => /Last tick:/.test(c.textContent)), 'tick sheet shows last-tick stats');

  body.children = [];
  fire(el('speedCtl'), 'click', {});
  ok(body.children.length > 0 && /tick/i.test(el('modalTitle').textContent), 'clicking the speed slider opens the tick-order sheet');

  console.log('');
  console.log(passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
