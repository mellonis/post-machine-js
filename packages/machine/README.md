# @post-machine-js/machine

[![build](https://github.com/mellonis/post-machine-js/actions/workflows/main.yml/badge.svg?branch=master)](https://github.com/mellonis/post-machine-js/actions/workflows/main.yml)
![npm (scoped)](https://img.shields.io/npm/v/@post-machine-js/machine)

A Post machine — a 2-symbol Turing-machine variant with a numbered-instruction program model — built on top of [`@turing-machine-js/machine`](https://github.com/mellonis/turing-machine-js).

## Install

`@post-machine-js/machine` declares `@turing-machine-js/machine` as a **peer dependency**, so both share a single instance of the upstream engine. The upstream library has runtime singletons (`haltState`, `ifOtherSymbol`, and the `Symbol`-keyed `movements` constants) whose identity is checked at runtime; duplicate copies in the bundle would break those checks.

```sh
npm install @turing-machine-js/machine @post-machine-js/machine
```

## Quick start

The Post machine alphabet has only two symbols — blank (` `) and mark (`*`). A program is a numbered map of instructions. The example below walks the head right while the cell under it is marked, then writes a mark on the first blank it finds:

```javascript
import { PostMachine, check, mark, right, stop, Tape } from '@post-machine-js/machine';

const machine = new PostMachine({
  10: check(20, 30),  // marked → go to 20 (step right); blank → go to 30 (mark)
  20: right(10),      // step right, then re-check at 10
  30: mark,           // write '*'; falls through to 40
  40: stop,
});

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['*', '*', ' '],
}));

await machine.run();
console.log(machine.tape.symbols.join('').trim()); // ***
```

Each instruction is a *state-producer*: `mark`, `right`, `erase`, etc. used bare advance to the next-numbered instruction; called as `mark(20)` they jump to instruction `20`. `check(ix1, ix0)` branches — `ix1` if the current cell is marked, else `ix0`. `stop` halts.

The state graph for the example above:

```mermaid
flowchart TD
    halt(((halt)))
    s10(("**10:** check(20, 30)"))
    s20["**20:** right(10)"]
    s30["**30:** mark"]

    s10 -- "marked (*)" --> s20
    s10 -- "blank" --> s30
    s20 -- "→ R" --> s10
    s30 -- "write *<br/>(40 stops)" --> halt
```

The `40: stop` instruction is elided in the graph — `stop` halts the machine, so the transition from `30: mark` flows straight to halt rather than through an intermediate state.

<details>
<summary>Same graph, as the engine actually emits via <code>toMermaid(State.toGraph(machine.initialState, machine.tapeBlock))</code>:</summary>

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  s1(("id:1"))
  s2["id:2"]
  s3["id:3"]
  s1 -- "\* → ·/S" --> s2
  s1 -- "- → ·/S" --> s3
  s2 -- "* → ·/R" --> s1
  s3 -- "* → */S" --> s0
```

Reading the engine output: states use auto-assigned IDs (`s0` is always `haltState`); double-circle nodes are halts, double-paren nodes are entry points, square nodes are intermediate states. Edge labels use the engine's compact `read → write/move` syntax: `\*` is the literal mark symbol, `-` is `ifOtherSymbol` (the catch-all for any symbol not explicitly enumerated), `·` is "keep" (no write), and `S`/`L`/`R` are stay/left/right.

</details>

## Classes

### PostMachine

The runtime. Subclasses `TuringMachine` from `@turing-machine-js/machine`: the constructor walks the numbered instruction list, materializes a state graph using the upstream `State` and `Reference` primitives, and runs it. Subroutines are introduced by adding string-keyed groups to the program (see [Subroutines](#subroutines) below).

**Constructor.** `new PostMachine(instructions, options?)` — `instructions` is the numbered-instruction map (with optional string-keyed subroutine groups); `options` is `{ blankSymbol?, markSymbol? }` (see [Custom symbols](#custom-symbols)).

**Methods.**
- `run({ stepsLimit?, onStep?, __onPause? } = {})` → `Promise<void>`. Runs to halt or until `stepsLimit` (default `1e5`) is exhausted. `onStep(machineState)` fires once per applied transition; `__onPause` forwards to the engine's debugger (see [Debugging](#debugging)).
- `runStepByStep({ stepsLimit? } = {})` → `Generator<MachineState>`. Synchronous step-at-a-time execution; the consumer drives the loop with `for ... of` or `.next()`.
- `replaceTapeWith(newTape)` — swap the active tape. Build the new tape against `machine.tape.alphabet` so symbol identities match the machine's interned alphabet.

**Properties.**
- `tape` — the active `Tape`. Equivalent to `tapeBlock.tapes[0]`.
- `tapeBlock` — the upstream `TapeBlock` wrapping `tape`. Pass to upstream utilities (`State.toGraph`, `summarize`, `equivalentOn`) when reaching past PostMachine.
- `initialState` — the entry `State` of the assembled state graph. Pass alongside `tapeBlock` to the upstream graph utilities.

### Tape

Reexported from [`@turing-machine-js/machine`](https://github.com/mellonis/turing-machine-js/tree/master/packages/machine). Post machine tapes use the 2-symbol alphabet ` `/`*`.

## Constants

* `alphabet` — the `Alphabet` instance for Post-machine tapes (` `, `*`).
* `blankSymbol` — the blank symbol, ` ` (space).
* `markSymbol` — the mark symbol, `*`.

## Custom symbols

The Post machine semantics are independent of which two characters represent blank and mark. Pass an options object as the second constructor argument to swap the glyphs — useful for rendering, interop with other formats, or didactic clarity. Both must be single characters and distinct from each other; passing neither (or `undefined` / `null`) falls back to the defaults.

```javascript
import { PostMachine, check, mark, right, stop, Tape } from '@post-machine-js/machine';

const machine = new PostMachine(
  {
    10: check(20, 30),
    20: right(10),
    30: mark,
    40: stop,
  },
  { blankSymbol: '.', markSymbol: '#' },
);

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['#', '#', '.'],
}));

await machine.run();
console.log(machine.tape.symbols.join('').replace(/\.+$/, '')); // ###
```

`mark`, `erase`, and `check` read the chosen symbols from the per-instance alphabet at build time; subroutines and grouped instructions inherit the same alphabet. Build the initial tape against `machine.tape.alphabet` (as in the snippet above) so your tape symbols are validated against the same alphabet the machine was built with.

## Commands

Each command is a higher-order function. Invoking it with no argument produces a state-producer that advances to the next numbered instruction; invoking with an explicit index jumps to that instruction.

### Core commands

* `check(ix1, ix0)` — if the current cell is marked, go to instruction `ix1`; otherwise go to `ix0`.
* `erase` / `erase(ix)` — write the blank symbol; go to the next / `ix`th instruction.
* `left` / `left(ix)` — move the head left; go to the next / `ix`th instruction.
* `mark` / `mark(ix)` — write the mark symbol; go to the next / `ix`th instruction.
* `right` / `right(ix)` — move the head right; go to the next / `ix`th instruction.
* `stop` — halt the machine.

### Subroutine commands

* `call(subroutineName)` / `call(subroutineName, ix)` — invoke a named subroutine; go to the next / `ix`th instruction afterwards.

### Other commands

* `noop` / `noop(ix)` — do nothing; go to the next / `ix`th instruction. A placeholder useful for reserving an instruction number in a worked example, or for an explicit jump that does no other work.

## Subroutines

A subroutine is a string-keyed group of numbered instructions — reusable logic invoked from the top-level program with `call(name)`. The minimum syntax: a single subroutine called once.

```javascript
import { PostMachine, call, check, mark, right, stop, Tape } from '@post-machine-js/machine';

const machine = new PostMachine({
  rightToBlank: {
    1: right,
    2: check(1, 3),
    3: stop,
  },
  1: call('rightToBlank'),
  2: mark,
  3: stop,
});

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['*', '*', ' '],
}));

await machine.run();
console.log(machine.tape.symbols.join('').trim()); // ***
```

The state graph (top-level flow with the subroutine as a black box):

```mermaid
flowchart TD
    halt(((halt)))
    t1(("**1:** call('rightToBlank')"))
    t2["**2:** mark"]
    sub[["rightToBlank<br/>(walks right until blank)"]]

    t1 -- "enters" --> sub
    sub -. "halts → return" .-> t2
    t2 -- "write *<br/>(3 stops)" --> halt
```

The `call('rightToBlank')` step at instruction 1 is built using the engine's `withOverrodeHaltState` composition primitive: the subroutine's halt is overridden to point at the next top-level instruction (instead of terminating the machine), so when the subroutine "halts" it actually returns to top-level execution at instruction 2.

<details>
<summary>Same graph, as the engine actually emits. The subroutine and the wrapping <code>withOverrodeHaltState</code> are visible:</summary>

```mermaid
flowchart TD
%% alphabets: [[" ","*"]]
  s0(((halt)))
  s2["id:2"]
  s3["id:3"]
  s4["id:4"]
  s5(("id:1>id:4"))
  s6["id:6"]
  s2 -- "* → ·/R" --> s3
  s3 -- "\* → ·/S" --> s2
  s3 -- "- → ·/S" --> s0
  s4 -- "* → ·/S" --> s6
  s5 -- "* → ·/S" --> s2
  s5 -. onHalt .-> s4
  s6 -- "* → */S" --> s0
```

Reading the engine output:
- `s5` is the top-level entry — the `id:1>id:4` label shows it's a `withOverrodeHaltState` wrapper: instruction 1 (`call`) with halt overridden to instruction 4 (the next top-level state after the subroutine returns).
- `s2`/`s3` form the subroutine's internal cycle: `s2` is `right` (keep+R), `s3` is `check(1, 3)` (loops back on `*`, exits to halt on blank).
- The dotted `onHalt` edge `s5 -.→ s4` is the override: when control flow reaches the subroutine's halt, the engine pops back to `s4` (the routing intermediate before `s6 = mark`).
- `s6` is the `mark` instruction (writes `*`, transitions to halt).

</details>

That's just syntax — for one call site, inlining is equivalent. Subroutines earn their keep when the same logic appears at multiple sites or when symmetric variants share a shape. Example: extend a marked region by one cell on each side, using mirrored `walkRightToBlank` / `walkLeftToBlank` helpers.

```javascript
import { PostMachine, call, check, left, mark, right, stop, Tape } from '@post-machine-js/machine';

const extend = new PostMachine({
  walkRightToBlank: {
    1: check(2, 3),
    2: right(1),
    3: stop,
  },
  walkLeftToBlank: {
    1: check(2, 3),
    2: left(1),
    3: stop,
  },
  10: call('walkRightToBlank'),  // find blank to the right of the marked region
  20: mark,                       // extend rightward
  30: call('walkLeftToBlank'),   // back through the region to the left blank
  40: mark,                       // extend leftward
  50: stop,
});

extend.replaceTapeWith(new Tape({
  alphabet: extend.tape.alphabet,
  symbols: [' ', '*', ' '],
  position: 1,
}));

await extend.run();
console.log(extend.tape.symbols.join('')); // ***
```

The two helpers have the same shape — a `check`/move/loop pair — with mirrored direction commands. Without subroutines, that loop body appears twice in the top-level program with `right` and `left` swapped; the structural cost is real and `summarize` makes it visible (see [Structural summary](#structural-summary--summarize)).

For a single subroutine called from MULTIPLE sites — the other archetypal use case — see the [duplicate-marked-region example](../../README.md#an-example-with-subroutines) in the root README.

## Introspection and equivalence

The v3 utilities from [`@turing-machine-js/machine`](https://github.com/mellonis/turing-machine-js/tree/master/packages/machine) work directly against a `PostMachine`. For the two most common ones — `summarize` and `equivalentOn` — this package also ships Post-aware free-function wrappers (`summarizePostMachine`, `equivalentPostMachines`) that bind the standard arguments and hide the `getTapeBlock`-must-clone footgun. **Prefer the wrappers for typical use.** The bare upstream functions are still re-exported here for advanced cases.

### Visualization — `toMermaid` + `State.toGraph`

```javascript
import { PostMachine, State, toMermaid, check, mark, right, stop } from '@post-machine-js/machine';

const machine = new PostMachine({
  10: check(20, 30),
  20: right(10),
  30: mark,
  40: stop,
});

const mermaid = toMermaid(State.toGraph(machine.initialState, machine.tapeBlock));
console.log(mermaid.split('\n')[0]); // flowchart TD
```

For the raw `Graph` as input to other tools, use `State.toGraph(machine.initialState, machine.tapeBlock)` directly.

### Structural summary — `summarizePostMachine`

`summarizePostMachine(machine)` returns counts about the assembled state graph: `stateCount`, `transitionCount`, `compositionEdgeCount`, `maxCompositionDepth`, `selfLoopCount`, `hasCycles`, `tapeCount`, `alphabetCardinalities`. For a PostMachine, `tapeCount` is always `1` and `alphabetCardinalities` is always `[2]` (one tape, two symbols — blank and mark); the interesting fields are the rest.

The typical use is comparing two implementations of the same algorithm — for example, an inline version against one factored through a subroutine:

```javascript
import { PostMachine, summarizePostMachine, call, check, mark, right, stop } from '@post-machine-js/machine';

// Both machines walk right to the first blank cell and mark it.

const inline = new PostMachine({
  10: check(20, 30),
  20: right(10),
  30: mark,
  40: stop,
});

const withSubroutine = new PostMachine({
  walkToBlank: {
    1: check(2, 3),
    2: right(1),
    3: stop,
  },
  10: call('walkToBlank'),
  20: mark,
  30: stop,
});

const a = summarizePostMachine(inline);
const b = summarizePostMachine(withSubroutine);

console.log(a.stateCount, a.compositionEdgeCount, a.maxCompositionDepth);
// 4 0 0 — inline: 4 states, no composition

console.log(b.stateCount, b.compositionEdgeCount, b.maxCompositionDepth);
// 6 1 1 — subroutine: 2 more states; 1 composition edge from `call` (depth 1)
```

Both programs do the same thing on the same input. The `withSubroutine` version pays for readability — factoring out the walk loop — with 50% more states and one composition edge. `summarizePostMachine` makes that cost measurable.

`summarizePostMachine(machine)` is sugar for `summarize(machine.initialState, machine.tapeBlock)`. The bare `summarize` is also re-exported for callers who already hold a `(state, tapeBlock)` pair.

### Behavioral equivalence — `equivalentPostMachines`

`equivalentPostMachines(reference, candidate, cases, options?)` runs both PostMachine instances against the same list of input tapes and reports per-case agreement, first-divergence step, and per-side step counts.

```javascript
import { PostMachine, equivalentPostMachines, check, mark, right, stop } from '@post-machine-js/machine';

const reference = new PostMachine({
  10: check(20, 30), 20: right(10), 30: mark, 40: stop,
});
const candidate = new PostMachine({
  10: check(20, 30), 20: right(10), 30: stop,  // forgot to mark
});

const report = equivalentPostMachines(reference, candidate, ['** ']);
console.log(report.allAgree); // false
```

Each case string is loaded onto a fresh clone of the originating PostMachine's tapeBlock per run (the wrapper handles the cloning — required because state-graph symbols are interned per-block). Cross-alphabet comparison and the `compareOutputs` / `compareSnapshots` options are passed through to upstream `equivalentOn`; see [equivalence specs](https://github.com/mellonis/turing-machine-js/blob/master/packages/machine/src/utilities/equivalence.spec.ts) for full option semantics.

The bare `equivalentOn` is also re-exported. Use it directly when you need a non-PostMachine `Runnable` on either side (e.g., comparing a `PostMachine` against a hand-rolled `TuringMachine`).

## Debugging

`pm.run()` accepts an experimental `__onPause?: (s: MachineState) => void | Promise<void>` parameter. It forwards as the upstream engine's `onPause` hook and fires whenever a state with `state.debug` set is reached. The `__` prefix marks the surface unstable — a higher-level per-instruction breakpoint API is being designed (tracked in [#59](https://github.com/mellonis/post-machine-js/issues/59)) and may rename or restructure this parameter without another major bump.

For the full debugger surface — per-state runtime-mutable breakpoints (`state.debug.before` / `state.debug.after` filters), the halt-pause (`haltState.debug.before`), and the `run({ debug: boolean })` master switch — operate against the upstream API directly. `machine.initialState` is the entry point: walk the graph from there to attach `state.debug` to specific reachable states. **PostMachine deliberately does not wrap any of this** — the planned breakpoint API will provide a higher-level surface once the design settles.

See [Debugging breakpoints (v4+)](https://github.com/mellonis/turing-machine-js/tree/master/packages/machine#debugging-breakpoints-v4) in the upstream README for the complete reference: filter shapes, ordering semantics (per-iter lifecycle is `before → step → after` on the same yield as of engine v6), and the `haltState.debug.after` rejection rule.

## Links

- [Post–Turing machine](https://en.wikipedia.org/wiki/Post%E2%80%93Turing_machine) on Wikipedia
- [@turing-machine-js/machine](https://github.com/mellonis/turing-machine-js/tree/master/packages/machine) — the upstream Turing-machine engine
