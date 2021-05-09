# post-machine-js

[![Build Status](https://travis-ci.com/mellonis/post-machine-js.svg?branch=master)](https://travis-ci.com/mellonis/post-machine-js)
[![Coverage Status](https://coveralls.io/repos/github/mellonis/post-machine-js/badge.svg?branch=master)](https://coveralls.io/github/mellonis/post-machine-js?branch=master)
![GitHub issues](https://img.shields.io/github/issues/mellonis/post-machine-js)

A convenient Post machine.

Under the hood, the `PostMachine` class builds some `State`s for `TuringMachine` from provided instructions. When you run it, it runs the built TuringMachine. 

This repository contains following packages:
* [@post-machine-js/machine](https://github.com/mellonis/post-machine-js/tree/master/packages/machine)

# An example

A tape contains two marked sections divided by the blank symbol(s). The issue is to move the first section close to the second. In other words, to remove blank symbols between these sections.

This example demonstrates an issue solving. 

```javascript
import PostMachine, {
  check, erase, left, mark, right, stop, Tape,
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
  symbolList: ['*', '*', '*', ' ', ' ', ' ', '*'],
}));

console.log(machine.tape.symbolList.join('').trim()); // ***   *

machine.run();

console.log(machine.tape.symbolList.join('').trim()); // ****
```

# An example with subroutines

A tape contains a marked section. The issue is to duplicate it.

This example demonstrates an issue solving with subroutines. A subroutine is a peace of code which can be reused multiple times. The issue could be solved without subroutines at all, but with them the algorithm looks more readable. 

```javascript
import PostMachine, {
  call, check, erase, left, mark, right, stop, Tape,
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
  symbolList: ['*'],
}));

console.log(machine.tape.symbolList.join('').trim()); // *

machine.run();

console.log(machine.tape.symbolList.join('').trim()); // **

// the second run

machine.replaceTapeWith(new Tape({
  alphabet: machine.tape.alphabet,
  symbolList: ['*', '*', '*'],
}));

console.log(machine.tape.symbolList.join('').trim()); // ***

machine.run();

console.log(machine.tape.symbolList.join('').trim()); // ******
```
