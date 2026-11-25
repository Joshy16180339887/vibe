(function () {
  'use strict';

  const Circuit = window.LGECircuit;
  const Netlist = window.LGENetlist;
  const VHDL = window.LGEVHDL;
  const Examples = window.LGEExamples;

  const GRID = 20;
  const STORE_KEY = 'lge-circuit-v1';

  const PULSE_MS = 120;
  const RATE_MAX = 61; // slider position 61 = max speed (unthrottled, fastest the PC allows)
  const SETTINGS_KEY = 'lge-settings-v1';

  const DIMS = {
    input:  { w: 84, h: 46 },
    pulse:  { w: 84, h: 46 },
    not:    { w: 66, h: 50 },
    and:    { w: 70, h: 52 },
    or:     { w: 70, h: 52 },
    xor:    { w: 78, h: 52 },
    nand:   { w: 78, h: 52 },
    nor:    { w: 78, h: 52 },
    xnor:   { w: 82, h: 52 },
    output: { w: 60, h: 60 },
    screen: { w: 130, h: 150 },
  };

  const PALETTE = ['input', 'pulse', 'and', 'or', 'not', 'xor', 'nand', 'nor', 'xnor', 'output', 'screen'];
  const PALETTE_LABELS = {
    input: 'Switch', pulse: 'Pulse', and: 'AND', or: 'OR', not: 'NOT', xor: 'XOR',
    nand: 'NAND', nor: 'NOR', xnor: 'XNOR', output: 'LED', screen: '4-bit Screen',
  };

  const COLORS = {
    bg: '#0b1220', grid: '#1c2942', comp: '#16213a', compStroke: '#3b4a6b',
    selected: '#38bdf8', text: '#dbe4f0', dim: '#8fa1bd',
    one: '#4ade80', zero: '#5b6b85', x: '#ef4444', wireDrag: '#38bdf8',
  };

  const SEGMAP = {
    0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd',
    6: 'afgcde', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg', 10: 'abcefg',
    11: 'cdefg', 12: 'adef', 13: 'bcdeg', 14: 'adefg', 15: 'aefg',
  };

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const statusEl = document.getElementById('status');
  const nameInput = document.getElementById('circuitName');

  const state = {
    circuit: null,
    tool: null,
    selection: null,
    drag: null,
    wireDrag: null,
    mouse: { x: 0, y: 0 },
    sim: null,
    mem: { loopValues: {} },
    rate: RATE_MAX,
    lastSim: 0,
    lastTickMs: 0,
    pendingTimer: null,
    viewW: 800,
    viewH: 600,
  };

  // ---------- geometry helpers ----------

  function snap(v) { return Math.round(v / GRID) * GRID; }

  function pinPos(comp, pin) {
    const d = DIMS[comp.type];
    if (comp.type === 'input' || comp.type === 'pulse') return { x: comp.x + d.w, y: comp.y + d.h / 2 };
    if (comp.type === 'output') return { x: comp.x, y: comp.y + d.h / 2 };
    if (comp.type === 'screen') {
      const i = parseInt(pin.slice(1), 10);
      return { x: comp.x, y: comp.y + 40 + i * 26 };
    }
    if (comp.type === 'not') {
      return pin === 'a' ? { x: comp.x, y: comp.y + d.h / 2 } : { x: comp.x + d.w, y: comp.y + d.h / 2 };
    }
    if (pin === 'a') return { x: comp.x, y: comp.y + d.h * 0.32 };
    if (pin === 'b') return { x: comp.x, y: comp.y + d.h * 0.68 };
    return { x: comp.x + d.w, y: comp.y + d.h / 2 };
  }

  function allPins(comp) {
    const p = Circuit.pinsOf(comp.type);
    return p.inputs.concat(p.outputs).map(pin => ({ comp: comp, pin: pin, pos: pinPos(comp, pin), dir: Circuit.pinDirection(comp.type, pin), ref: comp.id + '.' + pin }));
  }

  function pinAt(x, y) {
    let best = null;
    let bestD = 11;
    for (const c of state.circuit.components) {
      for (const p of allPins(c)) {
        const d = Math.hypot(p.pos.x - x, p.pos.y - y);
        if (d < bestD) { bestD = d; best = p; }
      }
    }
    return best;
  }

  function compAt(x, y) {
    for (let i = state.circuit.components.length - 1; i >= 0; i--) {
      const c = state.circuit.components[i];
      const d = DIMS[c.type];
      if (c.type === 'output') {
        const cx = c.x + d.w / 2;
        const cy = c.y + d.h / 2;
        if (Math.hypot(cx - x, cy - y) <= 22) return c;
      } else if (x >= c.x - 4 && x <= c.x + d.w + 4 && y >= c.y - 4 && y <= c.y + d.h + 4) {
        return c;
      }
    }
    return null;
  }

  function wirePath(w) {
    const f = Circuit.parseRef(w.from);
    const t = Circuit.parseRef(w.to);
    const fc = Circuit.getComp(state.circuit, f[0]);
    const tc = Circuit.getComp(state.circuit, t[0]);
    if (!fc || !tc) return null;
    const p1 = pinPos(fc, f[1]);
    const p2 = pinPos(tc, t[1]);
    const midx = (p1.x + p2.x) / 2;
    return [p1, { x: midx, y: p1.y }, { x: midx, y: p2.y }, p2];
  }

  function segDist(px, py, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - a.x) * dx + (py - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  function wireAt(x, y) {
    for (let i = state.circuit.wires.length - 1; i >= 0; i--) {
      const pts = wirePath(state.circuit.wires[i]);
      if (!pts) continue;
      for (let s = 0; s < pts.length - 1; s++) {
        if (segDist(x, y, pts[s], pts[s + 1]) < 7) return state.circuit.wires[i];
      }
    }
    return null;
  }

  // ---------- actions (also used by the Node smoke test) ----------

  function actionExportText() {
    return { filename: (state.circuit.name || 'circuit') + '.txt', text: Netlist.toText(state.circuit) };
  }

  function actionExportVHDL() {
    const dut = VHDL.toVHDL(state.circuit);
    const tb = VHDL.toTestbench(state.circuit);
    return [
      { filename: dut.entity + '.vhd', text: dut.code },
      { filename: tb.entity + '.vhd', text: tb.code },
    ];
  }

  function actionImport(text, format) {
    const fmt = format && format !== 'auto' ? format : Netlist.detectFormat(text);
    if (fmt === 'vhdl') return VHDL.fromVHDL(text);
    if (fmt === 'netlist') return Netlist.fromText(text);
    throw new Error('could not detect the format; pick "netlist" or "vhdl" explicitly');
  }

  function loadCircuit(circuit) {
    state.circuit = circuit;
    state.selection = null;
    state.tool = null;
    state.wireDrag = null;
    state.mem = { loopValues: {} };
    if (state.pendingTimer) { clearTimeout(state.pendingTimer); state.pendingTimer = null; }
    nameInput.value = circuit.name;
    refresh();
  }

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      if (typeof s.rate === 'number') state.rate = Math.min(RATE_MAX, Math.max(1, Math.round(s.rate)));
    } catch (e) { /* ignore */ }
  }

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ rate: state.rate })); } catch (e) { /* ignore */ }
  }

  // Full calculation (simulate + draw + status + save), throttled by the speed
  // setting: at max speed every change recalculates immediately; at N calc/s at
  // most one full recalculation happens per 1/N seconds, changes in between are
  // coalesced into the next tick. Structural changes are always drawn at once.
  function scheduleCalc() {
    if (state.rate >= RATE_MAX) { refresh(); return; }
    draw();
    const interval = 1000 / state.rate;
    const wait = interval - (Date.now() - state.lastSim);
    if (wait <= 0) { refresh(); return; }
    if (!state.pendingTimer) {
      state.pendingTimer = setTimeout(() => { state.pendingTimer = null; refresh(); }, wait);
    }
  }

  // ---------- state / persistence ----------

  function saveLocal() {
    try { localStorage.setItem(STORE_KEY, Circuit.serialize(state.circuit)); } catch (e) { /* storage unavailable */ }
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Circuit.deserialize(raw);
    } catch (e) { /* ignore */ }
    return null;
  }

  function refresh() {
    const t0 = Date.now();
    state.lastSim = t0;
    state.sim = Circuit.simulate(state.circuit, state.mem);
    state.lastTickMs = Date.now() - t0;
    resize();
    draw();
    updateStatus();
    saveLocal();
  }

  function updateStatus() {
    const v = Circuit.validate(state.circuit, state.sim);
    const parts = [];
    for (const iss of v.issues) parts.push(iss.msg);
    parts.push(state.circuit.components.length + ' components, ' + state.circuit.wires.length + ' wires');
    statusEl.textContent = parts.join('   |   ');
    statusEl.classList.toggle('error', v.issues.some(i => i.level === 'error'));
    statusEl.classList.toggle('warn', !v.issues.some(i => i.level === 'error') && v.issues.some(i => i.level === 'warn'));
  }

  // ---------- rendering ----------

  function resize() {
    const wrap = document.getElementById('canvasWrap');
    let maxX = (wrap.clientWidth || 800);
    let maxY = (wrap.clientHeight || 600);
    for (const c of state.circuit.components) {
      const d = DIMS[c.type];
      maxX = Math.max(maxX, c.x + d.w + 160);
      maxY = Math.max(maxY, c.y + d.h + 110);
    }
    const dpr = window.devicePixelRatio || 1;
    state.viewW = maxX;
    state.viewH = maxY;
    canvas.style.width = maxX + 'px';
    canvas.style.height = maxY + 'px';
    canvas.width = Math.round(maxX * dpr);
    canvas.height = Math.round(maxY * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function valColor(v) {
    return v === 1 ? COLORS.one : v === 0 ? COLORS.zero : COLORS.x;
  }

  function draw() {
    ctx.fillStyle = COLORS.bg;
    ctx.fillRect(0, 0, state.viewW, state.viewH);
    ctx.fillStyle = COLORS.grid;
    for (let gx = GRID; gx < state.viewW; gx += GRID) {
      for (let gy = GRID; gy < state.viewH; gy += GRID) {
        ctx.fillRect(gx - 1, gy - 1, 2, 2);
      }
    }
    for (const w of state.circuit.wires) drawWire(w);
    if (state.wireDrag) drawWirePreview();
    for (const c of state.circuit.components) drawComp(c);
    for (const c of state.circuit.components) drawPins(c);
  }

  function wirePts(w) { return wirePath(w); }

  function drawWire(w) {
    const pts = wirePts(w);
    if (!pts) return;
    const v = state.sim ? state.sim.wires[w.id] : null;
    const sel = state.selection && state.selection.kind === 'wire' && state.selection.id === w.id;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.strokeStyle = valColor(v === undefined ? null : v);
    ctx.lineWidth = sel ? 4.5 : 3;
    if (v === null) ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fill();
  }

  function drawWirePreview() {
    const wd = state.wireDrag;
    const p1 = wd.pos;
    const p2 = state.mouse;
    const midx = (p1.x + p2.x) / 2;
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(midx, p1.y);
    ctx.lineTo(midx, p2.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.strokeStyle = COLORS.wireDrag;
    ctx.lineWidth = 2.5;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawPins(comp) {
    for (const p of allPins(comp)) {
      const v = state.sim && state.sim.values[comp.id] ? state.sim.values[comp.id][p.pin] : null;
      ctx.beginPath();
      ctx.arc(p.pos.x, p.pos.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = valColor(v);
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0b1220';
      ctx.stroke();
    }
  }

  function selected(comp) {
    return state.selection && state.selection.kind === 'comp' && state.selection.id === comp.id;
  }

  function compFrame(comp) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(comp.x, comp.y, DIMS[comp.type].w, DIMS[comp.type].h, 8);
    else ctx.rect(comp.x, comp.y, DIMS[comp.type].w, DIMS[comp.type].h);
    ctx.fillStyle = COLORS.comp;
    ctx.fill();
    ctx.lineWidth = selected(comp) ? 2.5 : 1.5;
    ctx.strokeStyle = selected(comp) ? COLORS.selected : COLORS.compStroke;
    ctx.stroke();
  }

  function drawLabel(comp, yOffset) {
    ctx.fillStyle = COLORS.dim;
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(comp.label, comp.x + DIMS[comp.type].w / 2, comp.y + DIMS[comp.type].h + (yOffset || 6));
  }

  function drawComp(comp) {
    switch (comp.type) {
      case 'input': drawSwitch(comp); break;
      case 'pulse': drawPulse(comp); break;
      case 'output': drawLed(comp); break;
      case 'screen': drawScreen(comp); break;
      default: drawGate(comp); break;
    }
  }

  function drawPulse(comp) {
    const d = DIMS.pulse;
    compFrame(comp);
    const v = comp.value ? 1 : 0;
    ctx.fillStyle = v ? COLORS.one : COLORS.text;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('PULSE', comp.x + d.w / 2, comp.y + d.h / 2 - 7);
    ctx.beginPath();
    ctx.arc(comp.x + d.w / 2, comp.y + d.h - 13, 5, 0, Math.PI * 2);
    if (v) { ctx.shadowColor = COLORS.one; ctx.shadowBlur = 14; }
    ctx.fillStyle = v ? COLORS.one : COLORS.zero;
    ctx.fill();
    ctx.shadowBlur = 0;
    drawLabel(comp);
  }

  function drawSwitch(comp) {
    const d = DIMS.input;
    compFrame(comp);
    const v = comp.value ? 1 : 0;
    const tx = comp.x + d.w - 36;
    const ty = comp.y + d.h / 2 - 8;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(tx, ty, 26, 16, 8); else ctx.rect(tx, ty, 26, 16);
    ctx.fillStyle = v ? '#14532d' : '#1e293b';
    ctx.fill();
    ctx.strokeStyle = v ? COLORS.one : COLORS.compStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(v ? tx + 19 : tx + 7, ty + 8, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = v ? COLORS.one : COLORS.zero;
    ctx.fill();
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(v), comp.x + 10, comp.y + d.h / 2);
    drawLabel(comp);
  }

  function drawLed(comp) {
    const d = DIMS.output;
    const cx = comp.x + d.w / 2;
    const cy = comp.y + d.h / 2;
    const v = state.sim && state.sim.values[comp.id] ? state.sim.values[comp.id].a : null;
    ctx.beginPath();
    ctx.arc(cx, cy, 18, 0, Math.PI * 2);
    if (v === 1) {
      ctx.shadowColor = COLORS.one;
      ctx.shadowBlur = 18;
      ctx.fillStyle = COLORS.one;
    } else if (v === 0) {
      ctx.fillStyle = '#1e293b';
    } else {
      ctx.fillStyle = '#3f1212';
    }
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = selected(comp) ? 2.5 : 1.5;
    ctx.strokeStyle = selected(comp) ? COLORS.selected : (v === null ? COLORS.x : COLORS.compStroke);
    ctx.stroke();
    drawLabel(comp);
  }

  function drawGate(comp) {
    const d = DIMS[comp.type];
    const x = comp.x;
    const y = comp.y;
    const w = d.w;
    const h = d.h;
    const bubble = comp.type === 'not' || comp.type === 'nand' || comp.type === 'nor' || comp.type === 'xnor';
    const bw = bubble ? w - 10 : w;

    compFrame(comp);
    ctx.beginPath();
    ctx.strokeStyle = selected(comp) ? COLORS.selected : COLORS.text;
    ctx.lineWidth = 2;
    ctx.fillStyle = COLORS.comp;

    const base = comp.type === 'nand' ? 'and' : comp.type === 'nor' ? 'or' : comp.type === 'xnor' ? 'xor' : comp.type;

    if (base === 'not') {
      ctx.moveTo(x + 14, y + 9);
      ctx.lineTo(x + 14, y + h - 9);
      ctx.lineTo(x + bw - 10, y + h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (base === 'and') {
      ctx.moveTo(x + 8, y + 7);
      ctx.lineTo(x + 8 + bw * 0.42, y + 7);
      ctx.arc(x + 8 + bw * 0.42, y + h / 2, (h - 14) / 2, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(x + 8, y + h - 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      if (base === 'xor') {
        ctx.moveTo(x + 4, y + 7);
        ctx.quadraticCurveTo(x + bw * 0.42, y + h / 2, x + 4, y + h - 7);
        ctx.stroke();
        ctx.beginPath();
      }
      ctx.moveTo(x + 12, y + 7);
      ctx.quadraticCurveTo(x + bw * 0.5, y + h / 2, x + 12, y + h - 7);
      ctx.quadraticCurveTo(x + bw * 0.62, y + h - 9, x + bw - 2, y + h / 2);
      ctx.quadraticCurveTo(x + bw * 0.62, y + 9, x + 12, y + 7);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    if (bubble) {
      ctx.beginPath();
      ctx.arc(x + w - 5, y + h / 2, 5, 0, Math.PI * 2);
      ctx.fillStyle = COLORS.bg;
      ctx.fill();
      ctx.strokeStyle = selected(comp) ? COLORS.selected : COLORS.text;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.fillStyle = COLORS.dim;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(comp.type.toUpperCase(), x + w / 2, y + h / 2);
    drawLabel(comp);
  }

  function drawSegDigit(dx, dy, dw, dh, nibble) {
    const t = 5;
    const segs = {
      a: [[dx + 3, dy], [dx + dw - 3, dy]],
      g: [[dx + 3, dy + dh / 2], [dx + dw - 3, dy + dh / 2]],
      d: [[dx + 3, dy + dh], [dx + dw - 3, dy + dh]],
      f: [[dx, dy + 3], [dx, dy + dh / 2 - 3]],
      b: [[dx + dw, dy + 3], [dx + dw, dy + dh / 2 - 3]],
      e: [[dx, dy + dh / 2 + 3], [dx, dy + dh - 3]],
      c: [[dx + dw, dy + dh / 2 + 3], [dx + dw, dy + dh - 3]],
    };
    const on = nibble === null ? '' : (SEGMAP[nibble] || '');
    ctx.lineCap = 'round';
    for (const name of Object.keys(segs)) {
      const [a, b] = segs[name];
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.lineWidth = t;
      ctx.strokeStyle = on.indexOf(name) >= 0 ? '#4ade80' : '#1d3a2a';
      if (nibble === null && name === 'g') ctx.strokeStyle = '#4ade80';
      ctx.stroke();
    }
  }

  function drawScreen(comp) {
    const d = DIMS.screen;
    compFrame(comp);
    const nib = state.sim ? state.sim.screens[comp.id] : 0;
    ctx.fillStyle = '#0a0f1c';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(comp.x + 22, comp.y + 12, d.w - 34, 52, 6); else ctx.rect(comp.x + 22, comp.y + 12, d.w - 34, 52);
    ctx.fill();
    drawSegDigit(comp.x + 22 + 6, comp.y + 12 + 6, d.w - 34 - 12, 52 - 12, nib === null || nib === undefined ? null : nib);

    ctx.fillStyle = COLORS.dim;
    ctx.font = '10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < 4; i++) {
      const cx = comp.x + 32 + (3 - i) * 24;
      const cy = comp.y + 104;
      ctx.fillText(String(i), cx, cy - 16);
      const v = state.sim && state.sim.values[comp.id] ? state.sim.values[comp.id]['i' + i] : null;
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.fillStyle = valColor(v);
      ctx.fill();
      ctx.strokeStyle = '#0b1220';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = COLORS.text;
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText('0x' + (nib === null || nib === undefined ? '-' : nib.toString(16).toUpperCase()), comp.x + d.w / 2, comp.y + 132);
    drawLabel(comp);
  }

  // ---------- interaction ----------

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener('mousedown', (e) => {
    const p = canvasPos(e);
    state.mouse = p;
    const pin = pinAt(p.x, p.y);
    if (pin) {
      state.wireDrag = { ref: pin.ref, out: pin.dir === 'out', pos: pin.pos, compId: pin.comp.id };
      return;
    }
    const comp = compAt(p.x, p.y);
    if (comp) {
      state.selection = { kind: 'comp', id: comp.id };
      if (comp.type === 'pulse') {
        comp.value = 1;
        if (comp._timer) clearTimeout(comp._timer);
        comp._timer = setTimeout(() => { comp.value = 0; scheduleCalc(); }, PULSE_MS);
        scheduleCalc();
      }
      state.drag = { id: comp.id, dx: p.x - comp.x, dy: p.y - comp.y, downX: p.x, downY: p.y, moved: false, toggleCandidate: comp.type === 'input' };
      draw();
      return;
    }
    const w = wireAt(p.x, p.y);
    if (w) {
      state.selection = { kind: 'wire', id: w.id };
      draw();
      return;
    }
    state.selection = null;
    if (state.tool) {
      const d = DIMS[state.tool];
      const comp = Circuit.addComponent(state.circuit, state.tool, { x: snap(p.x - d.w / 2), y: snap(p.y - d.h / 2) });
      state.selection = { kind: 'comp', id: comp.id };
      scheduleCalc();
    } else {
      draw();
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    const p = canvasPos(e);
    state.mouse = p;
    if (state.drag) {
      const comp = Circuit.getComp(state.circuit, state.drag.id);
      if (comp) {
        const nx = snap(p.x - state.drag.dx);
        const ny = snap(p.y - state.drag.dy);
        if (Math.abs(p.x - state.drag.downX) + Math.abs(p.y - state.drag.downY) > 4) state.drag.moved = true;
        if (comp.x !== nx || comp.y !== ny) { comp.x = nx; comp.y = ny; draw(); }
      }
    } else if (state.wireDrag) {
      draw();
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    const p = canvasPos(e);
    if (state.wireDrag) {
      const wd = state.wireDrag;
      state.wireDrag = null;
      const target = pinAt(p.x, p.y);
      if (target && target.comp.id !== wd.compId && (target.dir === 'out') !== wd.out) {
        const from = wd.out ? wd.ref : target.ref;
        const to = wd.out ? target.ref : wd.ref;
        try {
          Circuit.addWire(state.circuit, from, to);
          state.selection = null;
        } catch (err) {
          flashStatus(err.message);
        }
      }
      scheduleCalc();
      return;
    }
    if (state.drag) {
      const comp = Circuit.getComp(state.circuit, state.drag.id);
      if (comp && !state.drag.moved && state.drag.toggleCandidate && comp.type === 'input') {
        comp.value = comp.value ? 0 : 1;
      }
      state.drag = null;
      scheduleCalc();
    }
  });

  canvas.addEventListener('dblclick', (e) => {
    const p = canvasPos(e);
    const comp = compAt(p.x, p.y);
    if (comp) {
      const label = window.prompt('Component label:', comp.label);
      if (label !== null && label.trim()) {
        comp.label = label.trim();
        scheduleCalc();
      }
    }
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = canvasPos(e);
    const comp = compAt(p.x, p.y);
    if (comp) { Circuit.removeComponent(state.circuit, comp.id); scheduleCalc(); return; }
    const w = wireAt(p.x, p.y);
    if (w) { Circuit.removeWire(state.circuit, w.id); scheduleCalc(); return; }
    state.tool = null;
    state.wireDrag = null;
    syncPalette();
    draw();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      state.tool = null;
      state.wireDrag = null;
      state.selection = null;
      syncPalette();
      scheduleCalc();
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (!state.selection) return;
      if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) return;
      if (state.selection.kind === 'comp') Circuit.removeComponent(state.circuit, state.selection.id);
      else Circuit.removeWire(state.circuit, state.selection.id);
      state.selection = null;
      scheduleCalc();
    }
  });

  let statusTimer = null;
  function flashStatus(msg) {
    statusEl.textContent = msg;
    statusEl.classList.add('error');
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(updateStatus, 2500);
  }

  // ---------- palette / toolbar / modal ----------

  function syncPalette() {
    const buttons = document.querySelectorAll('#palette button');
    buttons.forEach(b => b.classList.toggle('active', b.dataset.type === state.tool));
  }

  function buildPalette() {
    const pal = document.getElementById('palette');
    for (const type of PALETTE) {
      const b = document.createElement('button');
      b.textContent = PALETTE_LABELS[type];
      b.dataset.type = type;
      b.addEventListener('click', () => {
        state.tool = state.tool === type ? null : type;
        syncPalette();
      });
      pal.appendChild(b);
    }
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Click a tool, then the canvas to place. Drag pin to pin to wire. Click a switch to toggle; press a Pulse button for a short 1 (it never stays on, even when held). Feedback loops simulate and only warn. Double-click renames. Right-click deletes. Del removes selection. Esc cancels.';
    pal.appendChild(hint);
  }

  function modalEl() { return document.getElementById('modal'); }
  function openModal(title) {
    const m = modalEl();
    document.getElementById('modalTitle').textContent = title;
    const body = document.getElementById('modalBody');
    const buttons = document.getElementById('modalButtons');
    body.innerHTML = '';
    buttons.innerHTML = '';
    m.classList.remove('hidden');
    return { body: body, buttons: buttons };
  }
  function closeModal() { modalEl().classList.add('hidden'); }

  function modalButton(label, fn, primary) {
    const b = document.createElement('button');
    b.textContent = label;
    if (primary) b.className = 'primary';
    b.addEventListener('click', fn);
    return b;
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return Promise.reject(new Error('clipboard unavailable'));
  }

  function download(filename, text) {
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function addCodeBlock(parent, filename, text) {
    const label = document.createElement('div');
    label.className = 'fileLabel';
    label.textContent = filename;
    const ta = document.createElement('textarea');
    ta.readOnly = true;
    ta.value = text;
    ta.rows = Math.min(22, Math.max(6, text.split('\n').length));
    const row = document.createElement('div');
    row.className = 'btnRow';
    row.appendChild(modalButton('Copy', () => copyText(text).then(() => flashStatus('Copied ' + filename))));
    row.appendChild(modalButton('Download', () => download(filename, text)));
    parent.appendChild(label);
    parent.appendChild(ta);
    parent.appendChild(row);
  }

  function showExportText() {
    const r = actionExportText();
    const m = openModal('Export as text (for AI) — ' + r.filename);
    addCodeBlock(m.body, r.filename, r.text);
    m.buttons.appendChild(modalButton('Close', closeModal, true));
  }

  function showExportVHDL() {
    const files = actionExportVHDL();
    const m = openModal('Export VHDL for ModelSim / Intel');
    const note = document.createElement('div');
    note.className = 'hint';
    note.textContent = 'Compile in ModelSim with: vcom ' + files[0].filename + ' ' + files[1].filename + '  then  vsim work.' + files[1].entity.replace(/_tb$/, '') + '_tb  and  run -all. The second file is a testbench that applies every input combination.';
    m.body.appendChild(note);
    for (const f of files) addCodeBlock(m.body, f.filename, f.text);
    m.buttons.appendChild(modalButton('Close', closeModal, true));
  }

  function showImport() {
    const m = openModal('Import from text or VHDL');
    const sel = document.createElement('select');
    for (const [v, label] of [['auto', 'Auto-detect'], ['netlist', 'Text netlist (AI format)'], ['vhdl', 'VHDL (ModelSim)']]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      sel.appendChild(o);
    }
    const ta = document.createElement('textarea');
    ta.placeholder = 'Paste a logicgate-netlist v1 document or VHDL (entity + dataflow architecture) here...';
    ta.rows = 16;
    const err = document.createElement('div');
    err.className = 'errorText';
    m.body.appendChild(sel);
    m.body.appendChild(ta);
    m.body.appendChild(err);
    m.buttons.appendChild(modalButton('Import', () => {
      try {
        const c = actionImport(ta.value, sel.value);
        loadCircuit(c);
        closeModal();
        flashStatus('Imported "' + c.name + '": ' + c.components.length + ' components, ' + c.wires.length + ' wires');
      } catch (e2) {
        err.textContent = e2.message;
      }
    }, true));
    m.buttons.appendChild(modalButton('Close', closeModal));
  }

  function showTickSheet() {
    const m = openModal('Calculation order of one tick');
    const intro = document.createElement('div');
    intro.className = 'hint';
    intro.textContent = 'One tick = one full recalculation of the circuit. At speed "max" every change triggers a tick immediately (as fast as the PC allows); at N calc/s at most one tick runs per 1/N seconds and changes in between are coalesced into the next tick. Current speed: ' + (state.rate >= RATE_MAX ? 'max' : state.rate + ' calc/s') + '. The tick itself always runs in this order:';
    m.body.appendChild(intro);
    const ol = document.createElement('ol');
    ol.className = 'tickOrder';
    for (const step of Circuit.TICK_ORDER) {
      const li = document.createElement('li');
      li.textContent = step;
      ol.appendChild(li);
    }
    m.body.appendChild(ol);
    const stats = document.createElement('div');
    stats.className = 'hint';
    const s = state.sim;
    let loopInfo = '';
    if (s && s.loops && (s.loops.settled.length || s.loops.oscillating.length)) {
      loopInfo = ' — loop relaxation used ' + s.loops.iterations + ' iteration(s)' + (s.loops.oscillating.length ? ' and is oscillating: ' + s.loops.oscillating.join(', ') : ' (settled)');
    }
    stats.textContent = 'Last tick: ' + state.lastTickMs + ' ms for ' + state.circuit.components.length + ' components / ' + state.circuit.wires.length + ' wires' + loopInfo + '.';
    m.body.appendChild(stats);
    m.buttons.appendChild(modalButton('Close', closeModal, true));
  }

  function buildToolbar() {
    const sel = document.getElementById('examples');
    for (const name of Examples.list) {
      const o = document.createElement('option');
      o.value = name;
      o.textContent = Examples.names[name];
      sel.appendChild(o);
    }
    document.getElementById('btnLoadExample').addEventListener('click', () => loadCircuit(Examples.build(sel.value)));
    nameInput.addEventListener('change', () => { state.circuit.name = nameInput.value.trim() || 'circuit'; scheduleCalc(); });
    const speedEl = document.getElementById('speed');
    const speedLabel = document.getElementById('speedLabel');
    window.syncSpeedUI = function () {
      speedEl.value = state.rate;
      speedLabel.textContent = state.rate >= RATE_MAX ? 'max' : state.rate + ' calc/s';
    };
    speedEl.addEventListener('input', () => {
      state.rate = Math.min(RATE_MAX, Math.max(1, parseInt(speedEl.value, 10) || 1));
      window.syncSpeedUI();
      saveSettings();
      scheduleCalc();
    });
    window.syncSpeedUI();
    document.getElementById('speedCtl').addEventListener('click', () => showTickSheet());
    document.getElementById('btnExportText').addEventListener('click', showExportText);
    document.getElementById('btnExportVHDL').addEventListener('click', showExportVHDL);
    document.getElementById('btnImport').addEventListener('click', showImport);
    document.getElementById('btnClear').addEventListener('click', () => {
      if (window.confirm('Start a new empty circuit? The current one is kept in autosave history only in this browser tab session.')) {
        loadCircuit(Circuit.createCircuit('circuit'));
      }
    });
    modalEl().addEventListener('mousedown', (e) => { if (e.target === modalEl()) closeModal(); });
  }

  // ---------- boot ----------

  buildPalette();
  buildToolbar();
  loadSettings();
  if (window.syncSpeedUI) window.syncSpeedUI();
  loadCircuit(loadLocal() || Examples.build('mult2'));
  syncPalette();

  window.__lge = {
    state: state,
    Circuit: Circuit,
    Netlist: Netlist,
    VHDL: VHDL,
    Examples: Examples,
    loadCircuit: loadCircuit,
    refresh: refresh,
    scheduleCalc: scheduleCalc,
    RATE_MAX: RATE_MAX,
    showTickSheet: showTickSheet,
    actionExportText: actionExportText,
    actionExportVHDL: actionExportVHDL,
    actionImport: actionImport,
    PULSE_MS: PULSE_MS,
  };
})();
