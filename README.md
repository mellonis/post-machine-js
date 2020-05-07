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
  10: erase, // erase symbol and go to the 20th instruction
  20: right, // move the carriage to the right and go to the 30th instruction
  30: check(20, 40), // if marked go to the 20th instruction, or to the 40th otherwise
  40: mark, // put symbol and go to the 50th instruction
  50: right, // move the carriage to the right and go to the 60th instruction
  60: check(70, 90), // if marked go to the 70th instruction, or to the 90th otherwise
  70: left, // move the carriage to the left and go to the 80th instruction
  80: stop, // stop execution
  90: left, // move the carriage to the left and go to the 100th instruction
  100: check(90, 110), // if marked go to the 90th instruction, or to the 110th otherwise
  110: right(10), // move the carriage to the right and go to the 80th instruction
});

machine.tape = new Tape({
  alphabet: machine.tape.alphabet,
  symbolList: ['*', '*', '*', ' ', ' ', ' ', '*'],
});

console.log(machine.tape.symbolList.join('').trim()); // ***   *

machine.run();

console.log(machine.tape.symbolList.join('').trim()); // ****
```
