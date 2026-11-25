'use strict';

const path = require('path');
const Circuit = require(path.join(__dirname, '..', 'js', 'core', 'circuit.js'));
const Netlist = require(path.join(__dirname, '..', 'js', 'core', 'netlist.js'));
const VHDL = require(path.join(__dirname, '..', 'js', 'core', 'vhdl.js'));
const Examples = require(path.join(__dirname, '..', 'js', 'core', 'examples.js'));

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, name) {
  if (cond) { passed++; }
  else { failed++; failures.push(name); console.error('FAIL: ' + name); }
}

function eq(actual, expected, name) {
  ok(actual === expected, name + ' (expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual) + ')');
}

function throwsWith(fn, needle, name) {
  try {
    fn();
    failed++; failures.push(name + ' (did not throw)');
    console.error('FAIL: ' + name + ' (did not throw)');
  } catch (e) {
    ok(String(e.message).indexOf(needle) >= 0, name + ' (error was: ' + e.message + ')');
  }
}

function gateCircuit(type, a, b) {
  const c = Circuit.createCircuit('t');
  const i0 = Circuit.addComponent(c, 'input', { label: 'a', value: a });
  const i1 = Circuit.addComponent(c, 'input', { label: 'b', value: b });
  const g = Circuit.addComponent(c, type, {});
  const o = Circuit.addComponent(c, 'output', { label: 'y' });
  if (Circuit.GATE_TYPES[type].inputs.length === 2) {
    Circuit.addWire(c, i0.id + '.q', g.id + '.a');
    Circuit.addWire(c, i1.id + '.q', g.id + '.b');
  } else {
    Circuit.addWire(c, i0.id + '.q', g.id + '.a');
  }
  Circuit.addWire(c, g.id + '.y', o.id + '.a');
  return { c, o };
}

// ---------- 1. gate truth tables ----------
const TRUTH = {
  and:  [[0,0,0],[0,1,0],[1,0,0],[1,1,1]],
  or:   [[0,0,0],[0,1,1],[1,0,1],[1,1,1]],
  xor:  [[0,0,0],[0,1,1],[1,0,1],[1,1,0]],
  nand: [[0,0,1],[0,1,1],[1,0,1],[1,1,0]],
  nor:  [[0,0,1],[0,1,0],[1,0,0],[1,1,0]],
  xnor: [[0,0,1],[0,1,0],[1,0,0],[1,1,1]],
};
for (const type of Object.keys(TRUTH)) {
  for (const [a, b, exp] of TRUTH[type]) {
    const { c, o } = gateCircuit(type, a, b);
    const sim = Circuit.simulate(c);
    eq(sim.values[o.id].a, exp, 'gate ' + type + '(' + a + ',' + b + ')');
  }
}
for (const a of [0, 1]) {
  const { c, o } = gateCircuit('not', a, 0);
  const sim = Circuit.simulate(c);
  eq(sim.values[o.id].a, 1 - a, 'gate not(' + a + ')');
}

// unconnected gate input -> undefined (null)
{
  const c = Circuit.createCircuit('t');
  const i0 = Circuit.addComponent(c, 'input', { value: 1 });
  const g = Circuit.addComponent(c, 'and', {});
  const o = Circuit.addComponent(c, 'output', {});
  Circuit.addWire(c, i0.id + '.q', g.id + '.a');
  Circuit.addWire(c, g.id + '.y', o.id + '.a');
  eq(Circuit.simulate(c).values[o.id].a, null, 'unconnected gate input propagates null');
}

// ---------- 2. wire validation ----------
{
  const c = Circuit.createCircuit('t');
  const i0 = Circuit.addComponent(c, 'input', {});
  const g = Circuit.addComponent(c, 'and', {});
  const o = Circuit.addComponent(c, 'output', {});
  ok(!Circuit.validateWire(c, g.id + '.a', i0.id + '.q').ok, 'wire from input pin rejected');
  ok(!Circuit.validateWire(c, i0.id + '.q', g.id + '.y').ok, 'wire to output pin rejected');
  ok(!Circuit.validateWire(c, g.id + '.y', g.id + '.a').ok, 'self wire rejected');
  throwsWith(() => Circuit.addWire(c, 'nope.q', g.id + '.a'), 'unknown component', 'wire to unknown comp throws');
  Circuit.addWire(c, i0.id + '.q', g.id + '.a');
  const i1 = Circuit.addComponent(c, 'input', { value: 1 });
  Circuit.addWire(c, i1.id + '.q', g.id + '.a'); // replaces previous wire on same input pin
  eq(c.wires.length, 1, 're-wiring an input pin replaces the old wire');
  eq(Circuit.simulate(c).values[g.id].y, null, 'and with one unconnected input is null');
  Circuit.addWire(c, i0.id + '.q', g.id + '.b');
  eq(Circuit.simulate(c).values[g.id].y, 0, 'and(0,1) == 0 after re-wire');
  ok(Circuit.validateWire(c, i0.id + '.q', o.id + '.a').ok, 'valid wire accepted');
}

// ---------- 3. feedback loops: warn-only, simulated to a fixed point ----------
{
  // and/not cross-coupled with input 1 oscillates -> undefined + warning, not an error
  const c = Circuit.createCircuit('t');
  const g1 = Circuit.addComponent(c, 'and', {});
  const g2 = Circuit.addComponent(c, 'not', {});
  const i0 = Circuit.addComponent(c, 'input', { value: 1 });
  Circuit.addWire(c, i0.id + '.q', g1.id + '.a');
  Circuit.addWire(c, g1.id + '.y', g2.id + '.a');
  Circuit.addWire(c, g2.id + '.y', g1.id + '.b');
  const sim = Circuit.simulate(c);
  eq(sim.cyclic.length, 2, 'loop members detected');
  eq(sim.loops.oscillating.length, 2, 'and/not loop reported as oscillating');
  eq(sim.values[g1.id].y, null, 'oscillating loop output is undefined');
  const v = Circuit.validate(c, sim);
  ok(v.issues.length > 0 && v.issues.every(i => i.level === 'warn'), 'loops produce warnings only, never errors (non-blocking)');
  ok(/oscillates/.test(v.issues[0].msg), 'oscillation warning message mentions oscillation');
}

// SR latch built from two NOR gates: settles, keeps state between simulations
{
  const c = Circuit.createCircuit('sr_latch');
  const R = Circuit.addComponent(c, 'input', { label: 'R', value: 0 });
  const S = Circuit.addComponent(c, 'input', { label: 'S', value: 0 });
  const n1 = Circuit.addComponent(c, 'nor', { label: 'Q' });
  const n2 = Circuit.addComponent(c, 'nor', { label: 'Qbar' });
  const led = Circuit.addComponent(c, 'output', { label: 'Q' });
  Circuit.addWire(c, R.id + '.q', n1.id + '.a');
  Circuit.addWire(c, n2.id + '.y', n1.id + '.b');
  Circuit.addWire(c, S.id + '.q', n2.id + '.a');
  Circuit.addWire(c, n1.id + '.y', n2.id + '.b');
  Circuit.addWire(c, n1.id + '.y', led.id + '.a');

  const mem = { loopValues: {} };
  let sim = Circuit.simulate(c, mem);
  eq(sim.loops.settled.length, 2, 'SR latch loop settles');
  eq(sim.loops.oscillating.length, 0, 'SR latch does not oscillate');
  const v = Circuit.validate(c, sim);
  ok(v.issues.some(i => i.level === 'warn' && /settled/.test(i.msg)), 'settled loop produces a warning (not an error)');

  S.value = 1; R.value = 0;
  sim = Circuit.simulate(c, mem);
  eq(sim.values[n1.id].y, 1, 'S=1 sets Q=1');

  S.value = 0; R.value = 0;
  sim = Circuit.simulate(c, mem);
  eq(sim.values[n1.id].y, 1, 'latch holds Q=1 after S returns to 0 (memory between runs)');

  R.value = 1;
  sim = Circuit.simulate(c, mem);
  eq(sim.values[n1.id].y, 0, 'R=1 resets Q=0');

  R.value = 0;
  sim = Circuit.simulate(c, mem);
  eq(sim.values[n1.id].y, 0, 'latch holds Q=0 after R returns to 0');
}

// ring of three NOT gates oscillates forever
{
  const c = Circuit.createCircuit('ring');
  const g = [0, 1, 2].map(() => Circuit.addComponent(c, 'not', {}));
  Circuit.addWire(c, g[0].id + '.y', g[1].id + '.a');
  Circuit.addWire(c, g[1].id + '.y', g[2].id + '.a');
  Circuit.addWire(c, g[2].id + '.y', g[0].id + '.a');
  const sim = Circuit.simulate(c);
  eq(sim.loops.oscillating.length, 3, '3-NOT ring oscillates');
  eq(sim.values[g[0].id].y, null, 'oscillating ring shows undefined');
}

// ---------- 3b. pulse component ----------
{
  const c = Circuit.createCircuit('pulse_test');
  const p = Circuit.addComponent(c, 'pulse', { label: 'clk' });
  eq(p.value, 0, 'pulse defaults to 0');
  const o = Circuit.addComponent(c, 'output', {});
  Circuit.addWire(c, p.id + '.q', o.id + '.a');
  eq(Circuit.simulate(c).values[o.id].a, 0, 'pulse output 0 when not pressed');
  p.value = 1;
  eq(Circuit.simulate(c).values[o.id].a, 1, 'pulse output 1 while pressed');

  const text = Netlist.toText(c);
  ok(/^pulse \S+ label "clk" value 1/m.test(text), 'netlist exports pulse line with value');
  const back = Netlist.fromText(text);
  const bp = back.components.find(cc => cc.type === 'pulse');
  ok(!!bp, 'netlist import recreates the pulse component');
  eq(bp.value, 1, 'netlist round-trip keeps pulse value');

  const dut = VHDL.toVHDL(c);
  ok(/clk\s*:\s*in std_logic/.test(dut.code), 'VHDL export: pulse becomes an in std_logic port');
  const backV = VHDL.fromVHDL(dut.code);
  ok(backV.components.some(cc => cc.type === 'input' && cc.label === 'clk'), 'VHDL import: pulse port becomes a switch');
}

// ---------- 4. 4-bit screen ----------
{
  const c = Circuit.createCircuit('screen_test');
  const scr = Circuit.addComponent(c, 'screen', { label: 'disp' });
  const ins = [0, 1, 2, 3].map(i => Circuit.addComponent(c, 'input', { label: 'b' + i }));
  for (let i = 0; i < 4; i++) Circuit.addWire(c, ins[i].id + '.q', scr.id + '.i' + i);
  let allOk = true;
  for (let v = 0; v < 16; v++) {
    for (let i = 0; i < 4; i++) ins[i].value = (v >> i) & 1;
    const sim = Circuit.simulate(c);
    if (sim.screens[scr.id] !== v) allOk = false;
  }
  ok(allOk, '4-bit screen shows 0..15 for all switch combinations');
  for (let i = 0; i < 4; i++) ins[i].value = 1;
  Circuit.removeWire(c, c.wires[2].id);
  eq(Circuit.simulate(c).screens[scr.id], 11, 'screen treats an unconnected bit as 0 (consistent with VHDL export)');
}

// ---------- 5. example circuits behave correctly ----------
{
  const ha = Examples.build('half_adder');
  const scr = ha.components.find(c => c.type === 'screen');
  const ins = ha.components.filter(c => c.type === 'input');
  const expected = { '0,0': 0, '0,1': 1, '1,0': 1, '1,1': 2 };
  let allOk = true;
  for (const a of [0, 1]) for (const b of [0, 1]) {
    ins[0].value = a; ins[1].value = b;
    const sim = Circuit.simulate(ha);
    if (sim.screens[scr.id] !== expected[a + ',' + b]) allOk = false;
  }
  ok(allOk, 'half adder: screen shows sum + 2*carry for all inputs');

  const fa = Examples.build('full_adder');
  const fscr = fa.components.find(c => c.type === 'screen');
  const fins = fa.components.filter(c => c.type === 'input');
  allOk = true;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let ci = 0; ci < 2; ci++) {
    fins[0].value = a; fins[1].value = b; fins[2].value = ci;
    const sim = Circuit.simulate(fa);
    const sum = a ^ b ^ ci;
    const cout = (a & b) | ((a ^ b) & ci);
    if (sim.screens[fscr.id] !== (sum + 2 * cout)) allOk = false;
  }
  ok(allOk, 'full adder: screen shows sum + 2*cout for all 8 inputs');

  const m = Examples.build('mult2');
  const mscr = m.components.find(c => c.type === 'screen');
  const mins = m.components.filter(c => c.type === 'input');
  allOk = true;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    mins[0].value = (a >> 1) & 1; mins[1].value = a & 1;
    mins[2].value = (b >> 1) & 1; mins[3].value = b & 1;
    const sim = Circuit.simulate(m);
    if (sim.screens[mscr.id] !== a * b) allOk = false;
  }
  ok(allOk, '2-bit multiplier: screen shows a*b for all 16 combinations');
}

// ---------- 6. netlist text round-trip ----------
{
  const m = Examples.build('mult2');
  const text = Netlist.toText(m);
  ok(text.indexOf('logicgate-netlist v1') === 0, 'netlist starts with header');
  ok(/gate \S+ AND/.test(text), 'netlist contains AND gate line');
  ok(/wire \S+ from "[^"]+" to "[^"]+"/.test(text), 'netlist contains wire lines');
  const back = Netlist.fromText(text);
  eq(back.components.length, m.components.length, 'netlist round-trip: component count');
  eq(back.wires.length, m.wires.length, 'netlist round-trip: wire count');
  eq(back.name, m.name, 'netlist round-trip: name');

  const mins = m.components.filter(c => c.type === 'input');
  const bmins = back.components.filter(c => c.type === 'input');
  const mscr = m.components.find(c => c.type === 'screen').id;
  const bscr = back.components.find(c => c.type === 'screen').id;
  let allOk = true;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    mins[0].value = (a >> 1) & 1; mins[1].value = a & 1;
    mins[2].value = (b >> 1) & 1; mins[3].value = b & 1;
    bmins[0].value = mins[0].value; bmins[1].value = mins[1].value;
    bmins[2].value = mins[2].value; bmins[3].value = mins[3].value;
    const s1 = Circuit.simulate(m).screens[mscr];
    const s2 = Circuit.simulate(back).screens[bscr];
    if (s1 !== s2 || s1 !== a * b) allOk = false;
  }
  ok(allOk, 'netlist round-trip preserves behavior for all 16 multiplier inputs');

  // positions survive the round-trip
  const orig = m.components.find(c => c.type === 'screen');
  const backS = back.components.find(c => c.type === 'screen');
  eq(backS.x, orig.x, 'netlist round-trip: x position preserved');
  eq(backS.y, orig.y, 'netlist round-trip: y position preserved');

  throwsWith(() => Netlist.fromText('logicgate-netlist v1\ngate g1 FOO\n'), 'line 2', 'bad gate type reports line number');
  throwsWith(() => Netlist.fromText('logicgate-netlist v1\nwire from "a.q" to "b.a"\n'), 'unknown component', 'dangling wire reports error');
  throwsWith(() => Netlist.fromText('hello world\n'), 'unrecognized format', 'garbage input rejected');

  eq(Netlist.detectFormat(text), 'netlist', 'detectFormat: netlist');
  eq(Netlist.detectFormat('entity foo is port (a : in std_logic); end entity;'), 'vhdl', 'detectFormat: vhdl');
  eq(Netlist.detectFormat('random text'), null, 'detectFormat: unknown');
}

// ---------- 7. VHDL export ----------
{
  const m = Examples.build('mult2');
  const dut = VHDL.toVHDL(m);
  ok(/entity mult2_2bit is/.test(dut.code), 'VHDL: entity name from circuit name');
  ok(/a1\s*:\s*in std_logic/.test(dut.code), 'VHDL: input port declared');
  ok(/product\s*:\s*out std_logic_vector\(3 downto 0\)/.test(dut.code), 'VHDL: screen exported as 4-bit vector port');
  ok(/<= a0 and b0;/.test(dut.code), 'VHDL: AND expression emitted');
  ok(/<= a1 xor b0|<= b0 xor a1|<= a1 xor b0/.test(dut.code) || / xor /.test(dut.code), 'VHDL: XOR expression emitted');
  ok(/product\(0\) <= /.test(dut.code), 'VHDL: screen bit 0 assignment emitted');
  ok(/architecture rtl of mult2_2bit is/.test(dut.code), 'VHDL: architecture emitted');

  const tb = VHDL.toTestbench(m);
  ok(/entity mult2_2bit_tb is/.test(tb.code), 'testbench: entity named <dut>_tb');
  ok(/dut : entity work\.mult2_2bit port map \(/.test(tb.code), 'testbench: DUT instantiation');
  ok(/wait for 10 ns;/.test(tb.code), 'testbench: stimulus with waits');
  const waits = (tb.code.match(/wait for 10 ns;/g) || []).length;
  eq(waits, 16, 'testbench: 2^4 = 16 input combinations for 4 inputs');

  // VHDL round-trip: VHDL -> circuit -> simulate identical
  const back = VHDL.fromVHDL(dut.code);
  eq(back.components.filter(c => c.type === 'input').length, 4, 'VHDL import: 4 input switches');
  eq(back.components.filter(c => c.type === 'screen').length, 1, 'VHDL import: 1 screen');
  eq(back.components.filter(c => c.type === 'output').length, 4, 'VHDL import: 4 LEDs');
  const gateCount = back.components.filter(c => Circuit.GATE_TYPES[c.type]).length;
  eq(gateCount, m.components.filter(c => Circuit.GATE_TYPES[c.type]).length, 'VHDL import: same gate count');

  const mins = m.components.filter(c => c.type === 'input');
  const bmins = back.components.filter(c => c.type === 'input');
  const mscr = m.components.find(c => c.type === 'screen').id;
  const bscr = back.components.find(c => c.type === 'screen').id;
  let allOk = true;
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    const vals = [(a >> 1) & 1, a & 1, (b >> 1) & 1, b & 1];
    vals.forEach((v, i) => { mins[i].value = v; bmins[i].value = v; });
    const s1 = Circuit.simulate(m).screens[mscr];
    const s2 = Circuit.simulate(back).screens[bscr];
    if (s1 !== s2 || s1 !== a * b) allOk = false;
  }
  ok(allOk, 'VHDL round-trip preserves behavior for all 16 multiplier inputs');

  eq(Netlist.detectFormat(dut.code), 'vhdl', 'detectFormat: generated VHDL detected as vhdl');

  // structural lint of the generated VHDL
  const code = dut.code;
  ok(!/;\s*;/.test(code), 'VHDL lint: no empty statements');
  ok(!/\n\s*;\s*\n/.test(code), 'VHDL lint: no stray semicolon lines');
  const portNames = [...code.matchAll(/^\s{4}(\w+)\s*:\s*(in|out)\s+/gm)].map(mm => mm[1].toLowerCase());
  eq(new Set(portNames).size, portNames.length, 'VHDL lint: port names unique');
  const declSignals = [...code.matchAll(/^\s+signal\s+(\w+)\s*:/gm)].map(mm => mm[1]);
  const gateCount0 = m.components.filter(c => Circuit.GATE_TYPES[c.type]).length;
  eq(declSignals.length, gateCount0, 'VHDL lint: one signal per gate');
  for (const s of declSignals) ok(new RegExp('^\\s+' + s + '\\s*<=', 'm').test(code), 'VHDL lint: signal ' + s + ' is assigned');
  eq((code.match(/\bbegin\b/g) || []).length, 1, 'VHDL lint: exactly one begin (architecture body)');
  ok(/^end architecture rtl;$/m.test(code), 'VHDL lint: architecture closed');
  ok(/^end entity \w+;$/m.test(code), 'VHDL lint: entity closed');
  ok(!/\bprocess\b/.test(code), 'VHDL lint: DUT is pure dataflow (no processes)');
}

// ---------- 8. VHDL import of hand-written code (as an AI / ModelSim user would write) ----------
{
  const handWritten = [
    'library ieee;',
    'use ieee.std_logic_1164.all;',
    '',
    '-- a simple circuit written by hand',
    'entity parity is',
    '  port (',
    '    x : in std_logic;',
    '    y : in std_logic;',
    '    z : in std_logic;',
    '    odd_out : out std_logic;',
    '    nibble : out std_logic_vector(3 downto 0)',
    '  );',
    'end entity;',
    '',
    'architecture rtl of parity is',
    '  signal t1 : std_logic;',
    '  signal t2 : std_logic;',
    'begin',
    '  t1 <= x xor y;',
    '  t2 <= t1 xor z;',
    '  odd_out <= t2;',
    '  nibble(0) <= t2;',
    "  nibble(1) <= '0';",
    '  nibble(2) <= not x;',
    '  nibble(3) <= x nand y;',
    'end architecture;',
  ].join('\n');
  const c = VHDL.fromVHDL(handWritten);
  const ins = c.components.filter(cc => cc.type === 'input');
  const scr = c.components.find(cc => cc.type === 'screen');
  const out = c.components.find(cc => cc.type === 'output');
  eq(ins.length, 3, 'hand-written VHDL: 3 inputs');
  eq(c.name, 'parity', 'hand-written VHDL: entity name becomes circuit name');
  let allOk = true;
  for (let x = 0; x < 2; x++) for (let y = 0; y < 2; y++) for (let z = 0; z < 2; z++) {
    ins[0].value = x; ins[1].value = y; ins[2].value = z;
    const sim = Circuit.simulate(c);
    const odd = x ^ y ^ z;
    const nib = odd + 0 + 4 * (1 - x) + 8 * (1 - (x & y));
    if (sim.values[out.id].a !== odd) allOk = false;
    if (sim.screens[scr.id] !== nib) allOk = false;
  }
  ok(allOk, 'hand-written VHDL (comments, aliases, not/nand, vector bits) imports and simulates correctly');

  throwsWith(() => VHDL.fromVHDL('entity e is end entity; architecture a of e is begin u1: entity work.x port map (a => b); end architecture;'),
    'unsupported statement', 'component instantiation is rejected with a clear error');
}

// ---------- 9. full pipeline: editor model -> text -> AI/VHDL -> back ----------
{
  const fa = Examples.build('full_adder');
  const viaText = Netlist.fromText(Netlist.toText(fa));
  const viaVHDL = VHDL.fromVHDL(VHDL.toVHDL(fa).code);
  const fins = fa.components.filter(c => c.type === 'input');
  const tins = viaText.components.filter(c => c.type === 'input');
  const vins = viaVHDL.components.filter(c => c.type === 'input');
  const fscr = fa.components.find(c => c.type === 'screen').id;
  const tscr = viaText.components.find(c => c.type === 'screen').id;
  const vscr = viaVHDL.components.find(c => c.type === 'screen').id;
  let allOk = true;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let ci = 0; ci < 2; ci++) {
    [fins, tins, vins].forEach(list => { list[0].value = a; list[1].value = b; list[2].value = ci; });
    const s0 = Circuit.simulate(fa).screens[fscr];
    const s1 = Circuit.simulate(viaText).screens[tscr];
    const s2 = Circuit.simulate(viaVHDL).screens[vscr];
    if (!(s0 === s1 && s1 === s2)) allOk = false;
  }
  ok(allOk, 'full pipeline (editor -> text -> VHDL -> editor) is behavior-identical for the full adder');
}

// ---------- 10. serialize / deserialize (localStorage save) ----------
{
  const m = Examples.build('mult2');
  const back = Circuit.deserialize(Circuit.serialize(m));
  eq(back.components.length, m.components.length, 'serialize round-trip: components');
  const mins = m.components.filter(c => c.type === 'input');
  const bmins = back.components.filter(c => c.type === 'input');
  mins[0].value = 1; bmins[0].value = 1;
  const mscr = m.components.find(c => c.type === 'screen').id;
  const bscr = back.components.find(c => c.type === 'screen').id;
  eq(Circuit.simulate(back).screens[bscr], Circuit.simulate(m).screens[mscr], 'serialize round-trip: same simulation');
}

// ---------- 11. documented tick order matches the simulator's phases ----------
{
  ok(Array.isArray(Circuit.TICK_ORDER) && Circuit.TICK_ORDER.length >= 6, 'TICK_ORDER documents the tick phases');
  const joined = Circuit.TICK_ORDER.join(' ');
  ok(/topological/i.test(joined), 'TICK_ORDER mentions the topological sort');
  ok(/fixed point/i.test(joined), 'TICK_ORDER mentions loop fixed-point relaxation');
  ok(/screen/i.test(joined) && /i0/.test(joined), 'TICK_ORDER mentions 4-bit screen aggregation');
  ok(/localStorage/i.test(joined) || /Render/i.test(joined), 'TICK_ORDER mentions rendering/autosave');
}

console.log('');
console.log(passed + ' passed, ' + failed + ' failed');
if (failed) {
  console.log('Failures:');
  for (const f of failures) console.log('  - ' + f);
  process.exit(1);
}
