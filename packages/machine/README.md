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

machine.run();
console.log(machine.tape.symbols.join('').trim()); // ***
```

Each instruction is a *state-producer*: `mark`, `right`, `erase`, etc. used bare advance to the next-numbered instruction; called as `mark(20)` they jump to instruction `20`. `check(ix1, ix0)` branches — `ix1` if the current cell is marked, else `ix0`. `stop` halts.

## Classes

### PostMachine

The runtime. Subclasses `TuringMachine` from `@turing-machine-js/machine`: the constructor walks the numbered instruction list, materializes a state graph using the upstream `State` and `Reference` primitives, and runs it. Subroutines are introduced by adding string-keyed groups to the program (see [Subroutines](#subroutines) below).

### Tape

Reexported from [`@turing-machine-js/machine`](https://github.com/mellonis/turing-machine-js/tree/master/packages/machine). Post machine tapes use the 2-symbol alphabet ` `/`*`.

## Constants

* `alphabet` — the `Alphabet` instance for Post-machine tapes (` `, `*`).
* `blankSymbol` — the blank symbol, ` ` (space).
* `markSymbol` — the mark symbol, `*`.

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

machine.run();
console.log(machine.tape.symbols.join('').trim()); // ***
```

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

extend.run();
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

## Links

- [Post–Turing machine](https://en.wikipedia.org/wiki/Post%E2%80%93Turing_machine) on Wikipedia
- [@turing-machine-js/machine](https://github.com/mellonis/turing-machine-js/tree/master/packages/machine) — the upstream Turing-machine engine
