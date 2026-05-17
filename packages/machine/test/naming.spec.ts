import { describe, expect, test } from 'vitest';
import {
  PostMachine, State,
  call, check, erase, left, mark, noop, right, stop,
} from '../src/index';
import type { Graph } from '../src/index';

describe('PostMachine — top-level atomic-command names', () => {
  test('initialState has instruction-derived name "10"', () => {
    const machine = new PostMachine({ 10: mark, 20: stop });
    expect(machine.initialState.name).toBe('10');
  });

  test('check state at instruction 10 named "10"', () => {
    const machine = new PostMachine({
      10: check(20, 30),
      20: mark,
      30: stop,
    });
    expect(machine.initialState.name).toBe('10');
  });

  test('right, erase, left, noop states all named by instruction index', () => {
    const machine = new PostMachine({
      10: right,
      20: erase,
      30: left,
      40: noop,
      50: mark,
      60: stop,
    });
    expect(machine.initialState.name).toBe('10');
  });
});

describe('PostMachine — top-level call wrapper names', () => {
  test('call wrapper composite reads as "<sub>><caller>~<target>"', () => {
    const machine = new PostMachine({
      10: call('foo', 30),
      20: stop,
      30: stop,
      foo: { 1: stop },
    });
    expect(machine.initialState.name).toBe('foo>10~30');
  });

  test('tail-position call wrapper composite uses "halt"', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: { 1: stop },
    });
    expect(machine.initialState.name).toBe('foo>10~halt');
  });

  test('call falling through to the next sequential instruction', () => {
    const machine = new PostMachine({
      10: call('foo'),
      20: stop,
      foo: { 1: stop },
    });
    expect(machine.initialState.name).toBe('foo>10~20');
  });
});

function collectNames(machine: PostMachine): Set<string> {
  const graph: Graph = State.toGraph(machine.initialState, machine.tapeBlock);
  const names = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    names.add(node.name);
  }
  return names;
}

describe('PostMachine — subroutine body and hopper names', () => {
  test('subroutine inner states use fully-qualified names', () => {
    // Use mark/right/mark so all three instructions produce real (non-halt) states.
    const machine = new PostMachine({
      10: call('foo'),
      foo: {
        1: mark(2),
        2: right(3),
        3: mark,
      },
    });
    // Wrapper composite at top — hopper now named "foo".
    expect(machine.initialState.name).toBe('foo>10~halt');

    // Subroutine body instructions are fully-qualified.
    const names = collectNames(machine);
    expect(names.has('foo::1')).toBe(true);
    expect(names.has('foo::2')).toBe(true);
    expect(names.has('foo::3')).toBe(true);
  });

  test('nested subroutines use fully-qualified hopper names', () => {
    // outer::1 is a call (produces a wrapper composite, not a plain "outer::1" node);
    // outer::2 is mark (produces a real state named "outer::2").
    // inner::1 is mark (produces a real state named "outer::inner::1").
    const machine = new PostMachine({
      10: call('outer'),
      outer: {
        1: call('inner'),
        2: mark,
        inner: { 1: mark },
      },
    });
    // Top wrapper composite uses the top-level hopper name "outer".
    expect(machine.initialState.name).toBe('outer>10~halt');

    const names = collectNames(machine);
    // The nested call wrapper uses the fully-qualified hopper name "outer::inner".
    expect(names.has('outer::inner>outer::1~outer::2')).toBe(true);
    // outer::2 is a plain mark instruction — it has its own named state.
    expect(names.has('outer::2')).toBe(true);
    // Body states of inner subroutine are fully-qualified.
    expect(names.has('outer::inner::1')).toBe(true);
  });
});
