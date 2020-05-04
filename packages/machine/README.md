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

### PostMachine

### Tape

This class is reexported from the [`@turing-machine-js/machine`](https://github.com/mellonis/turing-machine-js/tree/next/packages/machine) library  

## Constants

* `blankSymbol` - the blank symbol, ` ` (space)
* `markSymbol` - the mark symbol, `*`

## Commands

* `left`/`left(ix)` - move the carriage to the left and go to the `next`/`ix` instruction
* `right`/`right(ix)` - move the carriage to the right and go to the `next`/`ix` instruction
* `mark`/`mark(ix)` - put the mark symbol into current tape section and go to the `next`/`ix` instruction
* `erase`/`erase(ix)` - put the blank symbol into current tape section and go to the `next`/`ix` instruction 
* `check(ix1,ix0)` - if current tape section marked go to `ix1` instruction or go to `ix0` instruction otherwise
* `stop` - stop the machine

## Links

- [Post–Turing machine](https://en.wikipedia.org/wiki/Post–Turing_machine) on the Wikipedia
