# @post-machine-js/machine

[![Build Status](https://travis-ci.com/mellonis/post-machine-js.svg?branch=master)](https://travis-ci.com/mellonis/post-machine-js)
![npm (scoped)](https://img.shields.io/npm/v/@post-machine-js/machine)

Some basic objects to build your own post machine  

## Install

Using npm:

```sh
npm install @post-machine-js/machine
```

or using yarn:

```sh
yarn add @post-machine-js/machine
```

## Classes

The following classes are exported from the library.

### PostMachine

### Tape

This class is reexported from the [`@turing-machine-js/machine`](https://github.com/mellonis/turing-machine-js/tree/next/packages/machine) library.

## Constants

The following constants are exported from the library.

* `alphabet` - the alphabet for the machine tapes. An `Alphabet` class instance implemented in [`@turing-machine-js/machine`](https://github.com/mellonis/turing-machine-js/tree/next/packages/machine) library.
* `blankSymbol` - the blank symbol, ` ` (space)
* `markSymbol` - the mark symbol, `*`

## Commands

The following commands are exported from the library.

### Common commands

* `check(ix1,ix0)` - if current tape section marked go to `ix1`th instruction or go to `ix0`th instruction otherwise
* `erase`/`erase(ix)` - put the blank symbol into current tape section and go to the `next`/`ix`th instruction
* `left`/`left(ix)` - move the carriage to the left and go to the `next`/`ix`th instruction
* `mark`/`mark(ix)` - put the mark symbol into current tape section and go to the `next`/`ix`th instruction
* `right`/`right(ix)` - move the carriage to the right and go to the `next`/`ix`th instruction
* `stop` - stop the machine

### Additional commands

* `call(subroutineName)`/`call(subroutineName,ix)` - execute a subroutine by `subroutineName` name and go to the `next`/`ix`th instruction
* `noop`/`noop(ix)` - do nothing and go to the `next`/`ix`th instruction

## Links

- [Post–Turing machine](https://en.wikipedia.org/wiki/Post–Turing_machine) on the Wikipedia
