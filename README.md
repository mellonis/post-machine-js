# post-machine-js

[![build](https://github.com/mellonis/post-machine-js/actions/workflows/main.yml/badge.svg)](https://github.com/mellonis/post-machine-js/actions/workflows/main.yml)
[![Coverage Status](https://coveralls.io/repos/github/mellonis/post-machine-js/badge.svg?branch=master)](https://coveralls.io/github/mellonis/post-machine-js?branch=master)
[![GitHub issues](https://img.shields.io/github/issues/mellonis/post-machine-js)](https://github.com/users/mellonis/projects/5)

A convenient Post machine.

Under the hood, the `PostMachine` class builds some `State`s for `TuringMachine` from provided instructions. When you run it, it runs the built TuringMachine. 

This repository contains following packages:
* [@post-machine-js/machine](https://github.com/mellonis/post-machine-js/tree/master/packages/machine)

## Installation

`@post-machine-js/machine` declares [@turing-machine-js/machine](https://github.com/mellonis/turing-machine-js) as a **peer dependency**, so both use the same Turing machine implementation (one instance in the bundle). Install:

```bash
npm install @turing-machine-js/machine @post-machine-js/machine
```

# An example

A tape contains two marked sections divided by the blank symbol(s). The issue is to move the first section close to the second. In other words, to remove blank symbols between these sections.

This example demonstrates an issue solving. 

```javascript
import {
  PostMachine, check, erase, left, mark, right, stop, Tape,
} from '@post-machine-js/machine';

const machine = new PostMachine({
  10: erase,
  20: right,
  30: check(20, 40),
  40: mark,
  50: right,
  60: check(70, 90),
  70: left,
  80: stop,
  90: left,
  100: check(90, 110),
  110: right(10),
});

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['*', '*', '*', ' ', ' ', ' ', '*'],
}));

console.log(machine.tape.symbols.join('').trim()); // ***   *

await machine.run();

console.log(machine.tape.symbols.join('').trim()); // ****
```

# An example with subroutines

A tape contains a marked section. The issue is to duplicate it.

This example demonstrates an issue solving with subroutines. A subroutine is a peace of code which can be reused multiple times. The issue could be solved without subroutines at all, but with them the algorithm looks more readable.

The example also uses **inline command groups** — `1: [mark, right, mark]` inside `markTwoCells` and `2: [right, erase]` at the top level — to bundle several commands under a single instruction number. See [Grouped instructions](packages/machine/README.md#grouped-instructions) in the package README for the syntax and the constraints (`check` and `stop` always throw in a group; indexed forms like `mark(20)` throw too, but bare forms — including bare `call('sub')` — are fine).

```javascript
import {
  PostMachine, call, check, erase, left, mark, right, stop, Tape,
} from '@post-machine-js/machine';

const machine = new PostMachine({
  leftAndGoToBlank: {
    1: left,
    2: check(1, 3),
    3: stop,
  },
  rightAndGoToBlank: {
    1: right,
    2: check(1, 3),
    3: stop,
  },
  markTwoCells: {
    1: [mark, right, mark],
  },
  1: call('leftAndGoToBlank'),
  2: [right, erase],
  3: call('rightAndGoToBlank'),
  4: call('rightAndGoToBlank'),
  5: call('markTwoCells'),
  6: call('leftAndGoToBlank'),
  7: left,
  8: check(1, 9),
  9: stop,
});

// the first run

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['*'],
}));

console.log(machine.tape.symbols.join('').trim()); // *

await machine.run();

console.log(machine.tape.symbols.join('').trim()); // **

// the second run

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbols: ['*', '*', '*'],
}));

console.log(machine.tape.symbols.join('').trim()); // ***

await machine.run();

console.log(machine.tape.symbols.join('').trim()); // ******
```
