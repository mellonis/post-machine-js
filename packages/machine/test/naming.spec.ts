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
  test('call wrapper composite reads as "<sub>(<caller>~<target>)"', () => {
    const machine = new PostMachine({
      10: call('foo', 30),
      20: stop,
      30: stop,
      foo: { 1: stop },
    });
    expect(machine.initialState.name).toBe('foo(10~30)');
  });

  test('tail-position call wrapper composite uses "halt"', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: { 1: stop },
    });
    expect(machine.initialState.name).toBe('foo(10~halt)');
  });

  test('call falling through to the next sequential instruction', () => {
    const machine = new PostMachine({
      10: call('foo'),
      20: stop,
      foo: { 1: stop },
    });
    expect(machine.initialState.name).toBe('foo(10~20)');
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

describe('PostMachine — group states and wrapper composite', () => {
  test('group inner states use "<outer>.<inner>" naming', () => {
    const machine = new PostMachine({
      50: [right, mark, erase],
      60: stop,
    });
    // The initialState is the group wrapper at instr 50.
    // Composite: "50.1(50~60)" (first inner of group wrapping continuation from 50 to 60).
    expect(machine.initialState.name).toBe('50.1(50~60)');

    const names = collectNames(machine);
    // Under engine v7's flatter emit, the wrapper appears as the bare '50.1' node
    // with an onHalt edge to the continuation '50~60'; the composite '50.1(50~60)'
    // lives only on state.name, not as a graph node.
    expect(names.has('50.1')).toBe(true);
    expect(names.has('50.2')).toBe(true);
    expect(names.has('50.3')).toBe(true);
    // 'stop' maps to haltState singleton — no separate named node for instruction 60.
    expect(names.has('50~60')).toBe(true);
  });

  test('tail-position group wrapper uses "halt" continuation target', () => {
    const machine = new PostMachine({
      50: [right, mark],
    });
    expect(machine.initialState.name).toBe('50.1(50~halt)');
  });

  test('group inside a subroutine uses fully-qualified prefix', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: {
        1: [right, mark],
        2: mark,   // use mark (not stop) — stop is haltState singleton, doesn't create a named state
      },
    });
    const names = collectNames(machine);
    // Under engine v7, the group wrapper appears as bare 'foo::1.1' with a separate
    // continuation node 'foo::1~foo::2'; the composite name 'foo::1.1(foo::1~foo::2)'
    // is only on state.name.
    expect(names.has('foo::1.1')).toBe(true);
    expect(names.has('foo::1.2')).toBe(true);
    expect(names.has('foo::2')).toBe(true);
    expect(names.has('foo::1~foo::2')).toBe(true);  // continuation
  });
});

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
    // Acyclic subroutine + plain first instruction → hopper dropped (#85).
    // The wrapper's bare is foo's first-instruction State (foo::1) directly;
    // composite name reflects that.
    expect(machine.initialState.name).toBe('foo::1(10~halt)');

    // Subroutine body instructions are fully-qualified.
    const names = collectNames(machine);
    expect(names.has('foo::1')).toBe(true);
    expect(names.has('foo::2')).toBe(true);
    expect(names.has('foo::3')).toBe(true);
    // Hopper dropped — no bare 'foo' node in the graph.
    expect(names.has('foo')).toBe(false);
  });

  test('nested subroutines use fully-qualified instruction names', () => {
    // outer::1 is a call (the inner call wraps a wrapper, so outer keeps its
    // hopper); outer::2 is a plain mark; inner::1 is a plain mark.
    const machine = new PostMachine({
      10: call('outer'),
      outer: {
        1: call('inner'),
        2: mark,
        inner: { 1: mark },
      },
    });
    // outer's first instruction is `call('inner')` — that produces a wrapper,
    // so #85's hopper-drop is blocked (engine #176 would unwrap the inner
    // wrapping). outer keeps its hopper named "outer".
    expect(machine.initialState.name).toBe('outer(10~halt)');

    const names = collectNames(machine);
    // inner is acyclic with a plain first instruction (mark) → hopper dropped.
    // No bare 'outer::inner' node; the inner-call wrapper composite is
    // 'outer::inner::1(outer::1~outer::2)' and inner's body states have FQ names.
    expect(names.has('outer::inner')).toBe(false);
    expect(names.has('outer::inner::1')).toBe(true);
    // outer::2 is a plain mark instruction — it has its own named state.
    expect(names.has('outer::2')).toBe(true);
    // outer keeps its hopper (acyclic but first instr is a wrapper).
    expect(names.has('outer')).toBe(true);
  });
});

describe('PostMachine — combined naming scenarios', () => {
  test('call inside subroutine — both call site and target are fq-prefixed', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: {
        1: call('bar'),
        2: mark,
        bar: { 1: mark },
      },
    });
    const names = collectNames(machine);
    // Under #85, `bar` is acyclic + plain first instruction (mark) → hopper
    // dropped; no bare 'foo::bar' node. The inner-call wrapper composite is
    // 'foo::bar::1(foo::1~foo::2)' on state.name, with body state 'foo::bar::1'
    // appearing as a node.
    expect(names.has('foo::bar')).toBe(false);
    expect(names.has('foo::bar::1')).toBe(true);
    expect(names.has('foo::1~foo::2')).toBe(true);
    expect(names.has('foo::2')).toBe(true);
  });

  test('group inside subroutine — inner indices namespaced', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: {
        1: [right, mark],
        2: mark,
      },
    });
    const names = collectNames(machine);
    // Group wrapper at foo::1 appears as bare 'foo::1.1' under v7; composite
    // 'foo::1.1(foo::1~foo::2)' lives only on state.name.
    expect(names.has('foo::1.1')).toBe(true);
    expect(names.has('foo::1.2')).toBe(true);    // non-first inner — standalone
    expect(names.has('foo::1~foo::2')).toBe(true); // continuation
    expect(names.has('foo::2')).toBe(true);      // next instruction in subroutine
  });

  test('tail call inside subroutine — continuation forwards to halt', () => {
    const machine = new PostMachine({
      10: call('foo'),
      foo: {
        1: call('bar'),
        bar: { 1: mark },
      },
    });
    const names = collectNames(machine);
    // Under #85, `bar` is acyclic + plain first instruction → hopper dropped.
    // No bare 'foo::bar' node; the bare 'foo::bar::1' is the wrapper's target,
    // and the tail-position continuation is 'foo::1~halt'.
    expect(names.has('foo::bar')).toBe(false);
    expect(names.has('foo::1~halt')).toBe(true);
    expect(names.has('foo::bar::1')).toBe(true);
  });

  test('deep nesting: subroutine inside subroutine, fully-qualified names accumulate', () => {
    const machine = new PostMachine({
      10: call('outer'),
      outer: {
        1: call('inner'),
        2: mark,
        inner: {
          1: call('deepest'),
          deepest: { 1: mark },
        },
      },
    });
    const names = collectNames(machine);
    // Each scope hops accumulate in the prefix. `deepest` is acyclic with a
    // plain first instruction → hopper dropped (#85); only its body state
    // 'outer::inner::deepest::1' appears in the graph.
    expect(names.has('outer::inner::deepest::1')).toBe(true);
    expect(names.has('outer::inner::deepest')).toBe(false);
  });
});
