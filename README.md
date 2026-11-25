# Logic Gate Studio

A zero-dependency, browser-based editor for building and testing logic-gate circuits.
The twist: every circuit can be **translated** in both directions —

- **Editor → text (AI):** export the circuit as a small, line-based netlist you can paste
  into any AI chat to reason about, extend, or debug the circuit.
- **Editor → VHDL (ModelSim / Intel):** export a synthesizable-style VHDL-93 dataflow design
  plus a ready-made testbench that applies every input combination.
- **Text / VHDL → editor:** paste a netlist or VHDL back in and the gates, switches, LEDs and
  4-bit screen reappear in the canvas, fully wired and simulating.

## Run it

No build step and no dependencies. Either open `index.html` directly in a browser, or serve
the folder (nicer, avoids any file:// quirks):

```bash
cd logic-gate-editor
python3 -m http.server 8000     # then open http://localhost:8000
```

## Using the editor

- Pick a part in the left palette (Switch, **Pulse**, AND, OR, NOT, XOR, NAND, NOR, XNOR, LED,
  **4-bit Screen**), then click the canvas to place it. Esc or right-click cancels the tool.
- Drag from an output pin (right side) to an input pin (left side) to create a wire — or in
  the other direction. An input pin accepts only one wire; re-wiring replaces the old one.
- Click a **switch** to toggle 0/1. Press a **Pulse** button to send a very short 1: it fires
  the moment you click and returns to 0 by itself after ~120 ms — it never stays on, even if
  you keep holding the mouse button. The circuit simulates live: wires turn green (1),
  grey (0) or red dashed (undefined), LEDs light up, and the **4-bit screen** shows the
  value of its 4 inputs as a hex digit (pin `i0` = LSB) plus 4 individual bit LEDs.
- **Feedback loops are supported, not blocked.** Loops (e.g. an SR latch made of two NOR
  gates) are simulated by relaxing them to a fixed point, and the loop state is kept between
  input changes, so latches hold their value. The status bar shows an amber *warning*
  ("feedback loop settled…") — never an error. Loops that can never settle (oscillators,
  e.g. a ring of three NOTs) are also just a warning and show as undefined.
- Double-click a component to rename it (labels become VHDL port names). Right-click deletes
  a component or wire; select + `Delete` works too.
- **Simulation speed** (header slider): from **max** — every change recalculates instantly, as
  fast as the PC allows — down to **1 calc/s**, where the whole circuit is recalculated exactly
  once per second. Structural edits (placing/moving/wiring) are always drawn immediately;
  only the calculation is throttled, and changes in between are coalesced into the next tick.
  The setting is remembered in `localStorage`.
- **Click the speed slider** to open a sheet that lists the exact calculation order of one
  tick (source sampling → topological sort → acyclic evaluation → loop fixed-point relaxation
  → downstream evaluation → wire/screen propagation → render/autosave) plus stats of the last
  tick (duration, component/wire counts, loop iterations).
- Circuits autosave to `localStorage` and reload on the next visit.
- Examples menu: half adder, full adder, and a 2-bit multiplier driving the 4-bit screen.

## Translation formats

### Text netlist (AI format) — `Export text (AI)`

```
logicgate-netlist v1
circuit "half_adder"
input in1 label "a" value 0 x 40 y 60
input in2 label "b" value 1 x 40 y 150
gate g3 XOR label "sum" x 260 y 60
gate g4 AND label "carry" x 260 y 160
output out5 label "sum" x 520 y 60
screen scr6 label "display" x 520 y 260
wire w7 from "in1.q" to "g3.a"
wire w8 from "in2.q" to "g3.b"
...
end
```

Grammar: one statement per line; `#` starts a comment; strings are double-quoted.
Components: `input` (switch, `value 0|1`), `pulse` (momentary button, `value 0|1`),
`gate <id> <AND|OR|NOT|XOR|NAND|NOR|XNOR>`, `output` (LED), `screen` (4-bit display).
Each accepts `label "..." x <n> y <n>`.
Wires: `wire <id> from "<comp>.<outpin>" to "<comp>.<inpin>"`.
Pin names: switch `q`; gates `a`,`b` in / `y` out; NOT `a`/`y`; LED `a`; screen `i0..i3`.
Paste this into an AI together with "extend/modify this netlist" and paste the answer back
into **Import** (auto-detected).

### VHDL (ModelSim / Intel) — `Export VHDL (ModelSim)`

Generates two files:

- `<name>.vhd` — VHDL-93 dataflow design. Switches and pulse buttons → `in std_logic` ports,
  LEDs → `out std_logic` ports, each 4-bit screen → `out std_logic_vector(3 downto 0)` (pin
  `i0` = bit 0), gates → internal signals with `and/or/not/xor/nand/nor/xnor` expressions.
  Note: feedback loops (latches) are kept as-is in the VHDL; ModelSim resolves them the same
  way (they settle to a stable state, or show 'X' if they oscillate).
- `<name>_tb.vhd` — testbench instantiating the DUT and applying **all** input combinations
  (up to 4096) with 10 ns steps.

In ModelSim:

```tcl
vcom mult2_2bit.vhd mult2_2bit_tb.vhd
vsim work.mult2_2bit_tb
add wave *
run -all
```

**Importing VHDL** supports the dataflow subset the exporter emits (and typical hand-written
equivalents): `entity` with a `port` clause of `std_logic` / `std_logic_vector(3 downto 0)`,
and an architecture whose body contains only concurrent assignments `lhs <= rhs;` where
`rhs` is a port/signal name, `'0'`/`'1'`, `not x`, or `x <op> y` with
`and or xor nand nor xnor`. Component instantiations and processes are rejected with a
clear error. Imported circuits are auto-laid-out; drag them into place.

## Project layout

```
index.html            app shell
css/style.css         styling
js/core/circuit.js    circuit model + simulator (browser global + Node module)
js/core/netlist.js    text netlist export/import (AI format)
js/core/vhdl.js       VHDL export (DUT + testbench) / VHDL import
js/core/examples.js   built-in example circuits
js/editor.js          canvas UI, wiring, live simulation, import/export dialogs
test/run-tests.js     core test suite (truth tables, screen, round-trips, VHDL lint)
test/smoke-ui.js      UI smoke test driving the editor with synthetic mouse events
```

## Tests

```bash
npm test          # = node test/run-tests.js && node test/smoke-ui.js
```

166 assertions cover: all seven gate truth tables, null propagation, wire validation,
feedback loops (SR-latch state memory across simulations, oscillating rings, warn-only
reporting), the pulse button, the 4-bit screen for all values 0–15, the example circuits
(half/full adder, 2-bit multiplier), netlist and VHDL export→import round-trips
(behavior-identical for every input combination), importing hand-written VHDL, structural
lint of the generated VHDL, the speed throttle (max = immediate, 10/s and 1/s ticks), the
tick-order sheet, and synthetic mouse interaction with the editor (place, wire, toggle,
pulse-while-held, delete).
