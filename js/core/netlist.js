(function (root, factory) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Circuit = isNode ? require('./circuit.js') : root.LGECircuit;
  const mod = factory(Circuit);
  if (isNode) module.exports = mod;
  else root.LGENetlist = mod;
})(typeof self !== 'undefined' ? self : globalThis, function (Circuit) {
  'use strict';

  const HEADER = 'logicgate-netlist v1';

  function esc(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function unesc(s) {
    return s.replace(/\\(.)/g, '$1');
  }

  function tokenize(line) {
    const tokens = [];
    const re = /"((?:[^"\\]|\\.)*)"|(\S+)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      tokens.push({ quoted: m[1] !== undefined, value: m[1] !== undefined ? unesc(m[1]) : m[2] });
    }
    return tokens;
  }

  function toText(circuit) {
    const L = [];
    L.push(HEADER);
    L.push('circuit "' + esc(circuit.name || 'circuit') + '"');
    for (const c of circuit.components) {
      const label = c.label != null ? ' label "' + esc(c.label) + '"' : '';
      const pos = ' x ' + Math.round(c.x) + ' y ' + Math.round(c.y);
      if (c.type === 'input' || c.type === 'pulse') {
        L.push(c.type + ' ' + c.id + label + ' value ' + (c.value ? 1 : 0) + pos);
      } else if (c.type === 'output') {
        L.push('output ' + c.id + label + pos);
      } else if (c.type === 'screen') {
        L.push('screen ' + c.id + label + pos);
      } else {
        L.push('gate ' + c.id + ' ' + c.type.toUpperCase() + label + pos);
      }
    }
    for (const w of circuit.wires) {
      L.push('wire ' + w.id + ' from "' + esc(w.from) + '" to "' + esc(w.to) + '"');
    }
    L.push('end');
    return L.join('\n') + '\n';
  }

  function parseAttrs(tokens, start, ln) {
    const attrs = {};
    let i = start;
    while (i < tokens.length) {
      const k = tokens[i].value.toLowerCase();
      if (i + 1 >= tokens.length) throw new Error('line ' + ln + ': attribute "' + k + '" is missing a value');
      attrs[k] = tokens[i + 1].value;
      i += 2;
    }
    return attrs;
  }

  function fromText(text) {
    const circuit = Circuit.createCircuit('circuit');
    const lines = String(text).split(/\r?\n/);
    let headerSeen = false;
    let endSeen = false;
    let sawAny = false;
    let anyPos = false;

    for (let li = 0; li < lines.length; li++) {
      const raw = lines[li];
      const hash = raw.indexOf('#');
      const line = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
      if (!line) continue;
      const tokens = tokenize(line);
      if (!tokens.length) continue;
      const kw = tokens[0].value.toLowerCase();
      const ln = li + 1;
      if (endSeen) throw new Error('line ' + ln + ': content after "end"');
      sawAny = true;

      if (kw === 'logicgate-netlist') {
        headerSeen = true;
        continue;
      }
      if (kw === 'end') {
        endSeen = true;
        continue;
      }
      if (kw === 'circuit') {
        circuit.name = tokens.length > 1 ? tokens[1].value : 'circuit';
        continue;
      }
      if (kw === 'wire') {
        let i = 1;
        let id = null;
        if (i < tokens.length && tokens[i].value.toLowerCase() !== 'from') {
          id = tokens[i].value;
          i++;
        }
        if (!tokens[i] || tokens[i].value.toLowerCase() !== 'from') throw new Error('line ' + ln + ': expected "from"');
        if (!tokens[i + 1]) throw new Error('line ' + ln + ': missing from-reference');
        if (!tokens[i + 2] || tokens[i + 2].value.toLowerCase() !== 'to') throw new Error('line ' + ln + ': expected "to"');
        if (!tokens[i + 3]) throw new Error('line ' + ln + ': missing to-reference');
        if (tokens.length > i + 4) throw new Error('line ' + ln + ': unexpected extra tokens');
        try {
          Circuit.addWire(circuit, tokens[i + 1].value, tokens[i + 3].value, id || undefined);
        } catch (e) {
          throw new Error('line ' + ln + ': ' + e.message);
        }
        continue;
      }

      if (kw === 'input' || kw === 'pulse' || kw === 'output' || kw === 'screen' || kw === 'gate') {
        if (!tokens[1]) throw new Error('line ' + ln + ': missing component id');
        const id = tokens[1].value;
        let type = kw;
        let attrs;
        if (kw === 'gate') {
          if (!tokens[2]) throw new Error('line ' + ln + ': missing gate type (AND OR NOT XOR NAND NOR XNOR)');
          type = tokens[2].value.toLowerCase();
          if (!Circuit.GATE_TYPES[type]) throw new Error('line ' + ln + ': unknown gate type "' + tokens[2].value + '"');
          attrs = parseAttrs(tokens, 3, ln);
        } else {
          attrs = parseAttrs(tokens, 2, ln);
        }
        const opts = { id: id };
        if (attrs.label != null) opts.label = attrs.label;
        if (attrs.x != null) { opts.x = parseFloat(attrs.x); if (!isFinite(opts.x)) throw new Error('line ' + ln + ': bad x'); anyPos = true; }
        if (attrs.y != null) { opts.y = parseFloat(attrs.y); if (!isFinite(opts.y)) throw new Error('line ' + ln + ': bad y'); anyPos = true; }
        if ((kw === 'input' || kw === 'pulse') && attrs.value != null) opts.value = parseInt(attrs.value, 10) ? 1 : 0;
        try {
          const comp = Circuit.addComponent(circuit, type, opts);
          if (anyPos) comp._hadPos = true;
        } catch (e) {
          throw new Error('line ' + ln + ': ' + e.message);
        }
        continue;
      }

      if (!headerSeen) throw new Error('unrecognized format: expected a "' + HEADER + '" netlist');
      throw new Error('line ' + ln + ': unknown keyword "' + tokens[0].value + '"');
    }

    if (!sawAny || (!headerSeen && !circuit.components.length && !circuit.wires.length)) {
      throw new Error('unrecognized format: expected a "' + HEADER + '" netlist');
    }
    if (!anyPos) Circuit.autoLayout(circuit);
    else Circuit.autoLayout(circuit, true);
    for (const c of circuit.components) delete c._hadPos;
    return circuit;
  }

  function detectFormat(text) {
    const t = String(text);
    if (/^\s*logicgate-netlist\b/m.test(t)) return 'netlist';
    if (/\bentity\s+[A-Za-z]\w*\s+is\b/i.test(t) && /\bport\s*\(/i.test(t)) return 'vhdl';
    if (/^\s*(circuit|gate|input|pulse|output|screen|wire)\b/m.test(t)) return 'netlist';
    if (/\barchitecture\s+\w+\s+of\s+\w+\s+is\b/i.test(t)) return 'vhdl';
    return null;
  }

  return { HEADER: HEADER, toText: toText, fromText: fromText, detectFormat: detectFormat };
});
