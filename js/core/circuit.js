(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = mod;
  if (root) root.LGECircuit = mod;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const GATE_TYPES = {
    not:  { inputs: ['a'], outputs: ['y'], fn: (a) => (a === null ? null : 1 - a) },
    and:  { inputs: ['a', 'b'], outputs: ['y'], fn: (a, b) => (a === null || b === null ? null : a & b) },
    or:   { inputs: ['a', 'b'], outputs: ['y'], fn: (a, b) => (a === null || b === null ? null : a | b) },
    xor:  { inputs: ['a', 'b'], outputs: ['y'], fn: (a, b) => (a === null || b === null ? null : a ^ b) },
    nand: { inputs: ['a', 'b'], outputs: ['y'], fn: (a, b) => (a === null || b === null ? null : 1 - (a & b)) },
    nor:  { inputs: ['a', 'b'], outputs: ['y'], fn: (a, b) => (a === null || b === null ? null : 1 - (a | b)) },
    xnor: { inputs: ['a', 'b'], outputs: ['y'], fn: (a, b) => (a === null || b === null ? null : 1 - (a ^ b)) },
  };

  const IO_TYPES = {
    input:  { inputs: [], outputs: ['q'] },
    pulse:  { inputs: [], outputs: ['q'] },
    output: { inputs: ['a'], outputs: [] },
    screen: { inputs: ['i0', 'i1', 'i2', 'i3'], outputs: [] },
  };

  const ALL_TYPES = Object.assign({}, GATE_TYPES, IO_TYPES);

  function pinsOf(type) {
    const t = ALL_TYPES[type];
    if (!t) return null;
    return { inputs: t.inputs.slice(), outputs: t.outputs.slice() };
  }

  function pinDirection(type, pin) {
    const t = ALL_TYPES[type];
    if (!t) return null;
    if (t.inputs.indexOf(pin) >= 0) return 'in';
    if (t.outputs.indexOf(pin) >= 0) return 'out';
    return null;
  }

  function parseRef(ref) {
    const s = String(ref);
    const i = s.lastIndexOf('.');
    if (i <= 0 || i === s.length - 1) throw new Error('bad pin reference: ' + ref);
    return [s.slice(0, i), s.slice(i + 1)];
  }

  function createCircuit(name) {
    return { name: name || 'circuit', components: [], wires: [], nextId: 1 };
  }

  function genId(circuit, prefix) {
    let id;
    do { id = (prefix || 'c') + circuit.nextId++; } while (idTaken(circuit, id));
    return id;
  }

  function idTaken(circuit, id) {
    return circuit.components.some(c => c.id === id) || circuit.wires.some(w => w.id === id);
  }

  function countType(circuit, type) {
    return circuit.components.filter(c => c.type === type).length;
  }

  function defaultLabel(circuit, type) {
    if (type === 'input') return 'in' + (countType(circuit, 'input') + 1);
    if (type === 'pulse') return 'pulse' + (countType(circuit, 'pulse') + 1);
    if (type === 'output') return 'led' + (countType(circuit, 'output') + 1);
    if (type === 'screen') return 'screen' + (countType(circuit, 'screen') + 1);
    return type + (countType(circuit, type) + 1);
  }

  function addComponent(circuit, type, opts) {
    opts = opts || {};
    if (!ALL_TYPES[type]) throw new Error('unknown component type: ' + type);
    const id = opts.id || genId(circuit, type === 'input' ? 'in' : type === 'pulse' ? 'p' : type === 'output' ? 'out' : type === 'screen' ? 'scr' : 'g');
    if (idTaken(circuit, id)) throw new Error('duplicate component id: ' + id);
    const comp = {
      id: id,
      type: type,
      x: opts.x || 0,
      y: opts.y || 0,
      label: opts.label != null ? String(opts.label) : defaultLabel(circuit, type),
    };
    if (type === 'input' || type === 'pulse') comp.value = opts.value ? 1 : 0;
    circuit.components.push(comp);
    return comp;
  }

  function getComp(circuit, id) {
    return circuit.components.find(c => c.id === id) || null;
  }

  function removeComponent(circuit, id) {
    circuit.components = circuit.components.filter(c => c.id !== id);
    circuit.wires = circuit.wires.filter(w => {
      const f = parseRef(w.from)[0];
      const t = parseRef(w.to)[0];
      return f !== id && t !== id;
    });
  }

  function wireAtTarget(circuit, ref) {
    return circuit.wires.find(w => w.to === ref) || null;
  }

  function validateWire(circuit, from, to) {
    let fc, fp, tc, tp;
    try {
      const a = parseRef(from); const b = parseRef(to);
      fc = a[0]; fp = a[1]; tc = b[0]; tp = b[1];
    } catch (e) {
      return { ok: false, error: e.message };
    }
    const fromC = getComp(circuit, fc);
    const toC = getComp(circuit, tc);
    if (!fromC) return { ok: false, error: 'unknown component: ' + fc };
    if (!toC) return { ok: false, error: 'unknown component: ' + tc };
    if (pinDirection(fromC.type, fp) !== 'out') return { ok: false, error: from + ' is not an output pin' };
    if (pinDirection(toC.type, tp) !== 'in') return { ok: false, error: to + ' is not an input pin' };
    if (fc === tc) return { ok: false, error: 'cannot wire a component to itself' };
    return { ok: true };
  }

  function addWire(circuit, from, to, id) {
    const v = validateWire(circuit, from, to);
    if (!v.ok) throw new Error(v.error);
    const existing = circuit.wires.find(w => w.from === from && w.to === to);
    if (existing) return existing;
    const prev = wireAtTarget(circuit, to);
    if (prev) circuit.wires = circuit.wires.filter(w => w.id !== prev.id);
    const wid = id || genId(circuit, 'w');
    if (idTaken(circuit, wid)) throw new Error('duplicate wire id: ' + wid);
    const wire = { id: wid, from: from, to: to };
    circuit.wires.push(wire);
    return wire;
  }

  function removeWire(circuit, id) {
    circuit.wires = circuit.wires.filter(w => w.id !== id);
  }

  function cloneCircuit(circuit) {
    return JSON.parse(JSON.stringify(circuit));
  }

  function norm(v) {
    return (v === undefined || v === null) ? null : (v ? 1 : 0);
  }

  // Human-readable specification of what one simulation tick does, in order.
  // Rendered by the editor's "tick order" sheet; kept next to simulate() on purpose.
  const TICK_ORDER = [
    'Sample sources: every switch and pulse button latches its current value (0/1) onto its output pin q.',
    'Build the dependency graph from the wires and topologically sort the components (Kahn\'s algorithm).',
    'Evaluate all acyclic components in topological order: each gate computes y from its wired input pins; an unconnected input is undefined and propagates as undefined (null).',
    'Feedback loops are relaxed to a fixed point: loop members are re-evaluated up to max(50, 4 x loop size) iterations, starting from the previous tick\'s loop state, so latches keep their state between ticks. Settled loops keep their values; loops that never settle (oscillators) produce only a warning and are shown as undefined.',
    'Components downstream of a loop are evaluated afterwards, once the loop values are final.',
    'Propagate values: every input pin and every wire takes the value of the output pin it connects to; each 4-bit screen combines pins i0..i3 into a hex digit (unconnected bit counts as 0).',
    'Render the tick: wire/pin colors, LED and screen states, status bar warnings, autosave to localStorage.',
  ];

  function simulate(circuit, mem) {
    mem = mem && typeof mem === 'object' ? mem : null;
    const comps = new Map(circuit.components.map(c => [c.id, c]));
    const wireByTarget = new Map();
    for (const w of circuit.wires) wireByTarget.set(w.to, w);

    const deps = new Map();
    for (const c of circuit.components) deps.set(c.id, new Set());
    for (const w of circuit.wires) {
      const f = parseRef(w.from)[0];
      const t = parseRef(w.to)[0];
      if (comps.has(f) && comps.has(t) && f !== t) deps.get(t).add(f);
    }

    const indeg = new Map();
    const dependents = new Map();
    for (const [id, d] of deps) {
      indeg.set(id, d.size);
      for (const dep of d) {
        if (!dependents.has(dep)) dependents.set(dep, []);
        dependents.get(dep).push(id);
      }
    }
    const queue = [];
    for (const [id, d] of indeg) if (d === 0) queue.push(id);
    const order = [];
    while (queue.length) {
      const id = queue.shift();
      order.push(id);
      for (const dep of dependents.get(id) || []) {
        indeg.set(dep, indeg.get(dep) - 1);
        if (indeg.get(dep) === 0) queue.push(dep);
      }
    }
    const orderSet = new Set(order);
    const remaining = circuit.components.filter(c => !orderSet.has(c.id)).map(c => c.id);
    const remSet = new Set(remaining);

    // true loop members = remaining nodes that can reach themselves; nodes merely
    // downstream of a loop are not loop members and are evaluated after relaxation
    const remDeps = new Map();
    const remDependents = new Map();
    for (const w of circuit.wires) {
      const f = parseRef(w.from)[0];
      const t = parseRef(w.to)[0];
      if (remSet.has(f) && remSet.has(t) && f !== t) {
        if (!remDeps.has(t)) remDeps.set(t, new Set());
        remDeps.get(t).add(f);
        if (!remDependents.has(f)) remDependents.set(f, []);
        remDependents.get(f).push(t);
      }
    }
    function reachesSelf(start) {
      const stack = (remDependents.get(start) || []).slice();
      const seen = new Set();
      while (stack.length) {
        const n = stack.pop();
        if (n === start) return true;
        if (seen.has(n)) continue;
        seen.add(n);
        for (const nx of remDependents.get(n) || []) stack.push(nx);
      }
      return false;
    }
    const cyclic = remaining.filter(reachesSelf);
    const cycSet = new Set(cyclic);
    const rest = remaining.filter(id => !cycSet.has(id));

    const values = {};
    for (const c of circuit.components) values[c.id] = {};
    const pinValue = (ref) => {
      const p = parseRef(ref);
      const v = values[p[0]];
      return v ? norm(v[p[1]]) : null;
    };

    for (const id of order) {
      const c = comps.get(id);
      const v = values[id];
      if (c.type === 'input' || c.type === 'pulse') {
        v.q = c.value ? 1 : 0;
      } else if (GATE_TYPES[c.type]) {
        const g = GATE_TYPES[c.type];
        const args = g.inputs.map(pin => {
          const w = wireByTarget.get(id + '.' + pin);
          return w ? pinValue(w.from) : null;
        });
        v.y = g.fn.apply(null, args);
      }
    }

    // Feedback loops are not blocked: relax them to a fixed point. The previous
    // loop state (mem.loopValues) is used as the starting point, so latches keep
    // their state between input changes. Loops that never settle (oscillators)
    // are reported and shown as undefined.
    const loops = { settled: [], oscillating: [], iterations: 0 };
    if (cyclic.length) {
      const MAX = Math.max(50, cyclic.length * 4);
      for (const id of cyclic) {
        const pins = pinsOf(comps.get(id).type);
        const prev = mem && mem.loopValues ? mem.loopValues[id] : null;
        for (const p of pins.inputs.concat(pins.outputs)) {
          values[id][p] = prev && prev[p] !== undefined && prev[p] !== null ? prev[p] : 0;
        }
      }
      let settled = false;
      for (loops.iterations = 0; loops.iterations < MAX; loops.iterations++) {
        let changed = false;
        for (const id of cyclic) {
          const g = GATE_TYPES[comps.get(id).type];
          if (!g) continue;
          const args = g.inputs.map(pin => {
            const w = wireByTarget.get(id + '.' + pin);
            return w ? pinValue(w.from) : null;
          });
          const y = g.fn.apply(null, args);
          if (values[id].y !== y) { values[id].y = y; changed = true; }
        }
        if (!changed) { settled = true; loops.iterations++; break; }
      }
      if (settled) {
        loops.settled = cyclic.slice();
      } else {
        loops.oscillating = cyclic.slice();
        for (const id of cyclic) {
          const pins = pinsOf(comps.get(id).type);
          for (const p of pins.inputs.concat(pins.outputs)) values[id][p] = null;
        }
      }
      if (mem) {
        mem.loopValues = mem.loopValues || {};
        for (const id of cyclic) mem.loopValues[id] = Object.assign({}, values[id]);
      }
    }

    // components downstream of a loop, in topological order of the remaining subgraph
    if (rest.length) {
      const indeg2 = new Map();
      for (const id of rest) {
        let d = 0;
        for (const dep of remDeps.get(id) || []) if (!cycSet.has(dep)) d++;
        indeg2.set(id, d);
      }
      const q2 = rest.filter(id => indeg2.get(id) === 0);
      while (q2.length) {
        const id = q2.shift();
        const g = GATE_TYPES[comps.get(id).type];
        if (g) {
          const args = g.inputs.map(pin => {
            const w = wireByTarget.get(id + '.' + pin);
            return w ? pinValue(w.from) : null;
          });
          values[id].y = g.fn.apply(null, args);
        }
        for (const dep of remDependents.get(id) || []) {
          if (cycSet.has(dep)) continue;
          indeg2.set(dep, indeg2.get(dep) - 1);
          if (indeg2.get(dep) === 0) q2.push(dep);
        }
      }
    }

    // input pins display the value arriving on their wire
    for (const c of circuit.components) {
      const pins = pinsOf(c.type);
      for (const p of pins.inputs) {
        const w = wireByTarget.get(c.id + '.' + p);
        values[c.id][p] = w ? pinValue(w.from) : null;
      }
    }

    const wireVals = {};
    for (const w of circuit.wires) wireVals[w.id] = pinValue(w.from);

    const screens = {};
    for (const c of circuit.components) {
      if (c.type !== 'screen') continue;
      let val = 0;
      for (let i = 0; i < 4; i++) {
        const b = values[c.id]['i' + i];
        if (b) val += 1 << i;
      }
      screens[c.id] = val;
    }

    return { values: values, wires: wireVals, screens: screens, cyclic: cyclic, loops: loops };
  }

  function componentDepths(circuit) {
    const deps = new Map();
    for (const c of circuit.components) deps.set(c.id, new Set());
    for (const w of circuit.wires) {
      const f = parseRef(w.from)[0];
      const t = parseRef(w.to)[0];
      if (deps.has(f) && deps.has(t) && f !== t) deps.get(t).add(f);
    }
    const depth = new Map();
    const visiting = new Set();
    function visit(id) {
      if (depth.has(id)) return depth.get(id);
      if (visiting.has(id)) return 0;
      visiting.add(id);
      let d = 0;
      for (const dep of deps.get(id) || []) d = Math.max(d, visit(dep) + 1);
      visiting.delete(id);
      depth.set(id, d);
      return d;
    }
    for (const c of circuit.components) visit(c.id);
    return depth;
  }

  function autoLayout(circuit, onlyMissing) {
    const depth = componentDepths(circuit);
    const perColumn = new Map();
    for (const c of circuit.components) {
      if (onlyMissing && c._hadPos) { delete c._hadPos; continue; }
      const d = depth.get(c.id) || 0;
      const n = perColumn.get(d) || 0;
      perColumn.set(d, n + 1);
      c.x = 40 + d * 190;
      c.y = 60 + n * 110;
    }
    return circuit;
  }

  function validate(circuit, sim) {
    sim = sim || simulate(circuit);
    const issues = [];
    if (sim.loops && sim.loops.settled.length) {
      issues.push({ level: 'warn', msg: 'feedback loop settled after ' + sim.loops.iterations + ' iteration(s): ' + sim.loops.settled.join(', ') + ' (state is kept between runs)' });
    }
    if (sim.loops && sim.loops.oscillating.length) {
      issues.push({ level: 'warn', msg: 'feedback loop never settles (oscillates, shown as undefined): ' + sim.loops.oscillating.join(', ') });
    }
    const unconnected = [];
    for (const c of circuit.components) {
      const pins = pinsOf(c.type);
      for (const p of pins.inputs) {
        if (!circuit.wires.some(w => w.to === c.id + '.' + p)) unconnected.push(c.id + '.' + p);
      }
    }
    if (unconnected.length) issues.push({ level: 'warn', msg: unconnected.length + ' unconnected input pin(s): ' + unconnected.join(', ') });
    return { issues: issues, sim: sim };
  }

  function serialize(circuit) {
    return JSON.stringify(circuit, null, 2);
  }

  function deserialize(json) {
    const c = typeof json === 'string' ? JSON.parse(json) : json;
    if (!c || !Array.isArray(c.components) || !Array.isArray(c.wires)) throw new Error('not a circuit document');
    if (typeof c.nextId !== 'number') {
      c.nextId = 1 + c.components.length + c.wires.length;
    }
    return c;
  }

  return {
    GATE_TYPES: GATE_TYPES,
    IO_TYPES: IO_TYPES,
    ALL_TYPES: ALL_TYPES,
    pinsOf: pinsOf,
    pinDirection: pinDirection,
    parseRef: parseRef,
    createCircuit: createCircuit,
    addComponent: addComponent,
    getComp: getComp,
    removeComponent: removeComponent,
    addWire: addWire,
    removeWire: removeWire,
    wireAtTarget: wireAtTarget,
    validateWire: validateWire,
    simulate: simulate,
    validate: validate,
    TICK_ORDER: TICK_ORDER,
    autoLayout: autoLayout,
    cloneCircuit: cloneCircuit,
    serialize: serialize,
    deserialize: deserialize,
  };
});
