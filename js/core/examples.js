(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Circuit = isNode ? require('./circuit.js') : root.LGECircuit;
  const mod = factory(Circuit);
  if (isNode) module.exports = mod;
  else root.LGEExamples = mod;
})(typeof self !== 'undefined' ? self : globalThis, function (Circuit) {
  'use strict';

  function buildEmpty() {
    return Circuit.createCircuit('empty');
  }

  function buildHalfAdder() {
    const c = Circuit.createCircuit('half_adder');
    const a = Circuit.addComponent(c, 'input', { x: 40, y: 60, label: 'a', value: 0 });
    const b = Circuit.addComponent(c, 'input', { x: 40, y: 150, label: 'b', value: 1 });
    const xor1 = Circuit.addComponent(c, 'xor', { x: 260, y: 60, label: 'sum' });
    const and1 = Circuit.addComponent(c, 'and', { x: 260, y: 160, label: 'carry' });
    const ledSum = Circuit.addComponent(c, 'output', { x: 520, y: 60, label: 'sum' });
    const ledCarry = Circuit.addComponent(c, 'output', { x: 520, y: 160, label: 'carry' });
    const scr = Circuit.addComponent(c, 'screen', { x: 520, y: 260, label: 'display' });
    Circuit.addWire(c, a.id + '.q', xor1.id + '.a');
    Circuit.addWire(c, b.id + '.q', xor1.id + '.b');
    Circuit.addWire(c, a.id + '.q', and1.id + '.a');
    Circuit.addWire(c, b.id + '.q', and1.id + '.b');
    Circuit.addWire(c, xor1.id + '.y', ledSum.id + '.a');
    Circuit.addWire(c, and1.id + '.y', ledCarry.id + '.a');
    Circuit.addWire(c, xor1.id + '.y', scr.id + '.i0');
    Circuit.addWire(c, and1.id + '.y', scr.id + '.i1');
    return c;
  }

  function buildFullAdder() {
    const c = Circuit.createCircuit('full_adder');
    const a = Circuit.addComponent(c, 'input', { x: 40, y: 40, label: 'a', value: 1 });
    const b = Circuit.addComponent(c, 'input', { x: 40, y: 130, label: 'b', value: 0 });
    const cin = Circuit.addComponent(c, 'input', { x: 40, y: 220, label: 'cin', value: 1 });
    const x1 = Circuit.addComponent(c, 'xor', { x: 240, y: 60, label: 'x1' });
    const sum = Circuit.addComponent(c, 'xor', { x: 440, y: 60, label: 'sum' });
    const t1 = Circuit.addComponent(c, 'and', { x: 240, y: 170, label: 't1' });
    const t2 = Circuit.addComponent(c, 'and', { x: 440, y: 170, label: 't2' });
    const cout = Circuit.addComponent(c, 'or', { x: 640, y: 140, label: 'cout' });
    const ledSum = Circuit.addComponent(c, 'output', { x: 660, y: 40, label: 'sum' });
    const ledCout = Circuit.addComponent(c, 'output', { x: 660, y: 230, label: 'cout' });
    const scr = Circuit.addComponent(c, 'screen', { x: 840, y: 120, label: 'display' });
    Circuit.addWire(c, a.id + '.q', x1.id + '.a');
    Circuit.addWire(c, b.id + '.q', x1.id + '.b');
    Circuit.addWire(c, x1.id + '.y', sum.id + '.a');
    Circuit.addWire(c, cin.id + '.q', sum.id + '.b');
    Circuit.addWire(c, a.id + '.q', t1.id + '.a');
    Circuit.addWire(c, b.id + '.q', t1.id + '.b');
    Circuit.addWire(c, x1.id + '.y', t2.id + '.a');
    Circuit.addWire(c, cin.id + '.q', t2.id + '.b');
    Circuit.addWire(c, t1.id + '.y', cout.id + '.a');
    Circuit.addWire(c, t2.id + '.y', cout.id + '.b');
    Circuit.addWire(c, sum.id + '.y', ledSum.id + '.a');
    Circuit.addWire(c, cout.id + '.y', ledCout.id + '.a');
    Circuit.addWire(c, sum.id + '.y', scr.id + '.i0');
    Circuit.addWire(c, cout.id + '.y', scr.id + '.i1');
    return c;
  }

  function buildMult2() {
    const c = Circuit.createCircuit('mult2_2bit');
    const a1 = Circuit.addComponent(c, 'input', { x: 40, y: 40, label: 'a1', value: 1 });
    const a0 = Circuit.addComponent(c, 'input', { x: 40, y: 120, label: 'a0', value: 0 });
    const b1 = Circuit.addComponent(c, 'input', { x: 40, y: 200, label: 'b1', value: 1 });
    const b0 = Circuit.addComponent(c, 'input', { x: 40, y: 280, label: 'b0', value: 1 });
    const t1 = Circuit.addComponent(c, 'and', { x: 250, y: 40, label: 'a0&b0' });
    const t2 = Circuit.addComponent(c, 'and', { x: 250, y: 120, label: 'a1&b0' });
    const t3 = Circuit.addComponent(c, 'and', { x: 250, y: 200, label: 'a0&b1' });
    const t4 = Circuit.addComponent(c, 'and', { x: 250, y: 280, label: 'a1&b1' });
    const p1 = Circuit.addComponent(c, 'xor', { x: 450, y: 100, label: 'p1' });
    const c1 = Circuit.addComponent(c, 'and', { x: 450, y: 190, label: 'c1' });
    const p2 = Circuit.addComponent(c, 'xor', { x: 650, y: 160, label: 'p2' });
    const p3 = Circuit.addComponent(c, 'and', { x: 650, y: 250, label: 'p3' });
    const scr = Circuit.addComponent(c, 'screen', { x: 860, y: 140, label: 'product' });
    const leds = [0, 1, 2, 3].map(i => Circuit.addComponent(c, 'output', { x: 1040, y: 40 + i * 80, label: 'p' + i }));

    Circuit.addWire(c, a0.id + '.q', t1.id + '.a');
    Circuit.addWire(c, b0.id + '.q', t1.id + '.b');
    Circuit.addWire(c, a1.id + '.q', t2.id + '.a');
    Circuit.addWire(c, b0.id + '.q', t2.id + '.b');
    Circuit.addWire(c, a0.id + '.q', t3.id + '.a');
    Circuit.addWire(c, b1.id + '.q', t3.id + '.b');
    Circuit.addWire(c, a1.id + '.q', t4.id + '.a');
    Circuit.addWire(c, b1.id + '.q', t4.id + '.b');
    Circuit.addWire(c, t2.id + '.y', p1.id + '.a');
    Circuit.addWire(c, t3.id + '.y', p1.id + '.b');
    Circuit.addWire(c, t2.id + '.y', c1.id + '.a');
    Circuit.addWire(c, t3.id + '.y', c1.id + '.b');
    Circuit.addWire(c, t4.id + '.y', p2.id + '.a');
    Circuit.addWire(c, c1.id + '.y', p2.id + '.b');
    Circuit.addWire(c, t4.id + '.y', p3.id + '.a');
    Circuit.addWire(c, c1.id + '.y', p3.id + '.b');

    const bits = [t1, p1, p2, p3];
    for (let i = 0; i < 4; i++) {
      Circuit.addWire(c, bits[i].id + '.y', scr.id + '.i' + i);
      Circuit.addWire(c, bits[i].id + '.y', leds[i].id + '.a');
    }
    return c;
  }

  const BUILDERS = {
    empty: buildEmpty,
    half_adder: buildHalfAdder,
    full_adder: buildFullAdder,
    mult2: buildMult2,
  };

  const NAMES = {
    empty: 'Empty canvas',
    half_adder: 'Half adder',
    full_adder: 'Full adder',
    mult2: '2-bit multiplier -> 4-bit screen',
  };

  function build(name) {
    if (!BUILDERS[name]) throw new Error('unknown example: ' + name);
    return BUILDERS[name]();
  }

  return { list: Object.keys(BUILDERS), names: NAMES, build: build };
});
